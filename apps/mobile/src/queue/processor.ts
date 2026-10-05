import { type AllowedExtension, MIME_BY_EXT, VIDEO_EXTENSIONS } from "@photos/shared";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Network from "expo-network";
import { ApiError, api } from "../api/client";
import { useQueueEvents } from "../lib/events";
import { useSettings } from "../lib/store";
import { bumpAttempt, getNextPending, getQueueDb, type QueueItem, setState } from "./db";
import { sha256File } from "./hash";
import { makeThumbAndHash } from "./thumb";

const MAX_ATTEMPTS = 6;
const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 7_200_000, 7_200_000];

let running = false;
let cancelled = false;

export function cancelQueue() {
  cancelled = true;
}

export function isRunning() {
  return running;
}

async function canUploadNow(): Promise<{ ok: boolean; reason?: "wifi" }> {
  if (!useSettings.getState().wifiOnly) return { ok: true };
  const net = await Network.getNetworkStateAsync();
  const type = net.type;
  if (type === Network.NetworkStateType.WIFI || type === Network.NetworkStateType.ETHERNET) {
    return { ok: true };
  }
  return { ok: false, reason: "wifi" };
}

function extFromFilename(filename: string | null, mediaType: string): AllowedExtension {
  const raw = (filename?.split(".").pop() ?? "").toLowerCase();
  const fallback = mediaType === "video" ? "mp4" : "jpg";
  const ext = (raw || fallback) as AllowedExtension;
  return (MIME_BY_EXT as Record<string, string>)[ext] ? ext : (fallback as AllowedExtension);
}

function parseExifDate(exif: Record<string, unknown> | null | undefined): number | null {
  if (!exif) return null;
  const raw =
    (exif.DateTimeOriginal as string | undefined) ??
    (exif["{TIFF}"] as Record<string, unknown> | undefined)?.DateTimeOriginal ??
    (exif["{Exif}"] as Record<string, unknown> | undefined)?.DateTimeOriginal;
  if (typeof raw !== "string") return null;
  // Formato EXIF: "YYYY:MM:DD HH:MM:SS"
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
}

function extToMediaType(ext: string): "photo" | "video" {
  return VIDEO_EXTENSIONS.includes(ext) ? "video" : "photo";
}

async function uploadFile(
  target: { url: string; headers: Record<string, string> },
  fileUri: string,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  // Presigned PUT: enviar exactamente el content-type firmado; el OS pone content-length.
  const headers = { ...target.headers };
  delete headers["content-length"]; // el upload task lo calcula y debe coincidir
  const task = FileSystem.createUploadTask(
    target.url,
    fileUri,
    {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
      headers,
    },
    onProgress ? (p) => onProgress(p.totalBytesSent, p.totalBytesExpectedToSend) : undefined,
  );
  const res = await task.uploadAsync();
  if (!res || (res.status !== 200 && res.status !== 204)) {
    throw new Error(`Upload failed: ${res?.status}`);
  }
}

async function processItem(item: QueueItem): Promise<void> {
  const db = getQueueDb();

  const info = await MediaLibrary.getAssetInfoAsync(item.asset_id, {
    shouldDownloadFromNetwork: true,
  });
  const localUri = info.localUri ?? item.uri;
  const file = new File(localUri);
  const fileSize = file.size ?? 0;
  const ext = extFromFilename(item.filename, item.media_type);
  const mimeType = MIME_BY_EXT[ext];
  const mediaType = extToMediaType(ext);
  const takenAt = parseExifDate(info.exif as Record<string, unknown> | null) ?? item.created_at;
  const lat = info.location?.latitude ?? null;
  const lon = info.location?.longitude ?? null;
  const width = info.width || 1;
  const height = info.height || 1;
  const durationMs = item.media_type === "video" ? Math.round((info.duration ?? 0) * 1000) : null;

  setState(item.asset_id, "hashing", { bytes_total: fileSize });
  const sha256 = await sha256File(localUri);

  setState(item.asset_id, "thumbnailing");
  const thumb = await makeThumbAndHash(mediaType, localUri);

  setState(item.asset_id, "init", { sha256 });
  const init = await api.initUpload({
    sha256,
    mediaType,
    mimeType,
    ext,
    fileSize,
    thumbSize: thumb.bytes,
    takenAt,
    latitude: lat,
    longitude: lon,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    durationMs,
    thumbhash: thumb.thumbhash,
  });

  if (init.status === "duplicate") {
    setState(item.asset_id, "duplicate", { remote_id: init.id, bytes_sent: fileSize });
    safeDelete(thumb.uri);
    return;
  }

  setState(item.asset_id, "uploading_thumb", { remote_id: init.id });
  await uploadFile(init.thumb, thumb.uri);
  safeDelete(thumb.uri);

  setState(item.asset_id, "uploading_original");
  const fileUri = file.uri;
  let lastProgress = 0;
  await uploadFile(init.original, fileUri, (sent) => {
    const now = Date.now();
    if (now - lastProgress > 500) {
      lastProgress = now;
      db.runSync("UPDATE queue SET bytes_sent = ? WHERE asset_id = ?", [sent, item.asset_id]);
      useQueueEvents.getState().emit();
    }
  });

  setState(item.asset_id, "completing", { bytes_sent: fileSize });
  await api.completeUpload(init.id);
  setState(item.asset_id, "done", { remote_id: init.id, bytes_sent: fileSize });
  useQueueEvents.getState().emit();
}

function safeDelete(uri: string) {
  try {
    new File(uri).delete();
  } catch {}
}

export type ProcessOptions = { maxItems?: number; deadlineMs?: number };

export async function processQueue(opts: ProcessOptions = {}): Promise<void> {
  if (running) return;
  running = true;
  cancelled = false;
  let processed = 0;
  try {
    while (true) {
      if (cancelled) break;
      if (opts.maxItems !== undefined && processed >= opts.maxItems) break;
      if (opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs) break;

      const net = await canUploadNow();
      if (!net.ok) break;

      const item = getNextPending();
      if (!item) break;

      try {
        await processItem(item);
        processed++;
      } catch (e) {
        const db = getQueueDb();
        const row = db.getFirstSync<{ attempts: number }>(
          "SELECT attempts FROM queue WHERE asset_id = ?",
          [item.asset_id],
        );
        const attempts = (row?.attempts ?? item.attempts) + 1;
        bumpAttempt(item.asset_id);
        const message =
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
        if (attempts >= MAX_ATTEMPTS) {
          setState(item.asset_id, "failed", { last_error: message });
        } else {
          const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
          db.runSync("UPDATE queue SET next_retry_at = ? WHERE asset_id = ?", [
            Date.now() + wait,
            item.asset_id,
          ]);
          setState(item.asset_id, "queued", { last_error: message });
        }
        useQueueEvents.getState().emit();
      }
    }
  } finally {
    running = false;
  }
}
