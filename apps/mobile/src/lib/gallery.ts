import type { SyncStatus, TimelineItem } from "@photos/shared";
import type { QueueItem, QueueState } from "../queue/types";
import { sectionLabel } from "./format";

/**
 * Núcleo de la galería híbrida: fusión pura (sin I/O) de tres fuentes —
 * assets locales del dispositivo, cola de respaldo y timeline remoto del API —
 * en una lista única de fotos con su estado de sincronización. La lógica de
 * colisiones vive aquí para poder probarla en Vitest sin React Native.
 */

export type LocalAsset = {
  id: string;
  uri: string;
  mediaType: "photo" | "video";
  /** ms epoch, fecha de captura */
  creationTime: number;
  width: number;
  height: number;
  durationMs?: number | null;
  albumId?: string | null;
};

export type HybridPhoto = {
  /** Clave estable para listas (prefijada por origen). */
  key: string;
  syncStatus: SyncStatus;
  /** Progreso de subida 0..1; null = indeterminado o no aplica. */
  progress: number | null;
  /** ms epoch para ordenar y seccionar. */
  takenAt: number;
  mediaType: "photo" | "video";
  width: number;
  height: number;
  durationMs: number | null;
  /** URI local usable como origen de imagen (asset o blob de la cola). */
  localUri: string | null;
  /** Miniatura remota prefirmada. */
  thumbUrl: string | null;
  thumbhash: string | null;
  remoteId: string | null;
  assetId: string | null;
  albumId?: string | null;
  queueItem: QueueItem | null;
  remote: TimelineItem | null;
};

export type MergeInput = {
  localAssets: LocalAsset[];
  queueItems: QueueItem[];
  remoteItems: TimelineItem[];
};

export type GalleryRow =
  | { type: "header"; key: string; label: string }
  | { type: "photo"; key: string; photo: HybridPhoto };

const TERMINAL_STATES: ReadonlySet<QueueState> = new Set(["done", "duplicate"]);
const ACTIVE_STATES: ReadonlySet<QueueState> = new Set([
  "hashing",
  "thumbnailing",
  "init",
  "uploading_thumb",
  "uploading_original",
  "completing",
]);

/** Estado de la cola → estado del contrato de sincronización. */
export function queueStateToSyncStatus(state: QueueState): SyncStatus {
  if (state === "failed") return "FAILED";
  if (TERMINAL_STATES.has(state)) return "SYNCED";
  if (ACTIVE_STATES.has(state)) return "SYNCING";
  return "PENDING"; // queued
}

/** Progreso 0..1 solo cuando hay total conocido; null = indeterminado. */
function queueProgress(item: QueueItem): number | null {
  if (item.bytes_total > 0 && item.bytes_sent > 0) {
    return Math.min(1, item.bytes_sent / item.bytes_total);
  }
  return null;
}

export function mergeGallery({ localAssets, queueItems, remoteItems }: MergeInput): HybridPhoto[] {
  const localById = new Map(localAssets.map((a) => [a.id, a]));
  const remoteById = new Map(remoteItems.map((r) => [r.id, r]));
  const remoteBySha = new Map(remoteItems.map((r) => [r.sha256, r]));
  // Los remotos reclamados no se vuelven a emitir como REMOTE_ONLY sueltos.
  const claimedLocal = new Set<string>();
  const claimedRemote = new Set<string>();
  const photos: HybridPhoto[] = [];

  for (const q of queueItems) {
    const local = localById.get(q.asset_id) ?? null;
    if (local) claimedLocal.add(local.id);

    // Enlace cola↔remoto: remote_id directo; si falta, por sha256 (el API
    // deduplica por hash, así que un sha conocido identifica al media).
    const remote =
      (q.remote_id ? remoteById.get(q.remote_id) : null) ??
      (q.sha256 ? remoteBySha.get(q.sha256) : null) ??
      null;
    if (remote) claimedRemote.add(remote.id);

    const status = queueStateToSyncStatus(q.state);
    const base = {
      takenAt:
        remote?.takenAt ??
        (q.created_at > 0
          ? q.created_at
          : local?.creationTime && local.creationTime > 0
            ? local.creationTime
            : 1577836800000),
      mediaType: remote?.mediaType ?? q.media_type,
      width: remote?.width ?? local?.width ?? 1,
      height: remote?.height ?? local?.height ?? 1,
      durationMs: remote?.durationMs ?? local?.durationMs ?? null,
      thumbUrl: remote?.thumbUrl ?? null,
      thumbhash: remote?.thumbhash ?? null,
      remoteId: remote?.id ?? q.remote_id,
      assetId: q.asset_id,
      albumId: local?.albumId ?? null,
      queueItem: q,
      remote,
    };

    if (TERMINAL_STATES.has(q.state)) {
      // Sin remoto visible ni asset local no hay nada que mostrar (el remoto
      // puede no estar cargado aún por paginación): el tile llegará con su
      // página del timeline.
      if (!remote && !local) continue;
      photos.push({
        ...base,
        key: `q-${q.asset_id}`,
        // done sin asset local = el archivo ya no está en el dispositivo.
        syncStatus: local ? "SYNCED" : "REMOTE_ONLY",
        progress: null,
        localUri: local?.uri ?? null,
      });
    } else {
      photos.push({
        ...base,
        key: `q-${q.asset_id}`,
        syncStatus: status,
        progress: status === "SYNCING" ? queueProgress(q) : null,
        localUri: local?.uri ?? q.uri,
      });
    }
  }

  for (const a of localAssets) {
    if (claimedLocal.has(a.id)) continue;
    photos.push({
      key: `l-${a.id}`,
      syncStatus: "LOCAL_ONLY",
      progress: null,
      takenAt: a.creationTime,
      mediaType: a.mediaType,
      width: a.width,
      height: a.height,
      durationMs: a.durationMs ?? null,
      localUri: a.uri,
      thumbUrl: null,
      thumbhash: null,
      remoteId: null,
      assetId: a.id,
      albumId: a.albumId ?? null,
      queueItem: null,
      remote: null,
    });
  }

  for (const r of remoteItems) {
    if (claimedRemote.has(r.id)) continue;
    photos.push({
      key: `r-${r.id}`,
      syncStatus: "REMOTE_ONLY",
      progress: null,
      takenAt: r.takenAt,
      mediaType: r.mediaType,
      width: r.width,
      height: r.height,
      durationMs: r.durationMs,
      localUri: null,
      thumbUrl: r.thumbUrl,
      thumbhash: r.thumbhash,
      remoteId: r.id,
      assetId: null,
      albumId: null,
      queueItem: null,
      remote: r,
    });
  }

  photos.sort((a, b) => b.takenAt - a.takenAt || a.key.localeCompare(b.key));
  return photos;
}

/** Intercala encabezados de día (Hoy / Ayer / mes) sobre la lista ordenada desc. */
export function buildGalleryRows(photos: HybridPhoto[], now = Date.now()): GalleryRow[] {
  const rows: GalleryRow[] = [];
  let lastSection = "";
  for (const photo of photos) {
    const s = sectionLabel(photo.takenAt, now);
    if (s !== lastSection) {
      lastSection = s;
      rows.push({ type: "header", key: `h-${s}`, label: s });
    }
    rows.push({ type: "photo", key: photo.key, photo });
  }
  return rows;
}
