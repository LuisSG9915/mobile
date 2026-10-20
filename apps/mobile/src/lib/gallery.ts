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
  | { type: "header"; key: string; label: string; location?: string | null }
  | { type: "photo"; key: string; photo: HybridPhoto };

/**
 * Ciudad predominante de un grupo de fotos (normalmente un día): cuenta las
 * `remote.city` no vacías y devuelve la más frecuente. En empate gana la
 * primera encontrada; sin ciudades devuelve null.
 */
export function resolvePredominantLocation(items: HybridPhoto[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestCount = 0;
  for (const item of items) {
    const city = item.remote?.city?.trim();
    if (!city) continue;
    const count = (counts.get(city) ?? 0) + 1;
    counts.set(city, count);
    if (count > bestCount) {
      best = city;
      bestCount = count;
    }
  }
  return best;
}

const TERMINAL_STATES: ReadonlySet<QueueState> = new Set(["done", "duplicate"]);
const ACTIVE_STATES: ReadonlySet<QueueState> = new Set([
  "hashing",
  "thumbnailing",
  "init",
  "uploading_thumb",
  "uploading_original",
  "completing",
]);

/** Margen de captura para reconocer una foto tras reinstalar (sin sha local). */
const MATCH_WINDOW_MS = 3000;

/**
 * Empareja assets locales sin cola con remotos ya cargados usando huella de
 * metadatos: mismo tipo, mismas dimensiones (o giradas) y captura a ±3 s.
 *
 * Tras desinstalar/reinstalar la cola está vacía, así que sin esto cada foto
 * aparece dos veces (`l-<assetId>` local y `r-<remoteId>` en la nube).
 *
 * Solo acepta correspondencias 1:1 únicas: si un local encaja con dos remotos
 * (o dos locales con el mismo remoto, típico de una ráfaga del mismo segundo)
 * se descarta. Marcar un `queued` como `duplicate` por error haría que esa
 * foto nunca se respalde, así que la ambigüedad se resuelve sin emparejar.
 */
export function matchLocalToRemote(
  localAssets: LocalAsset[],
  remoteItems: TimelineItem[],
  claimedRemoteIds: ReadonlySet<string> = new Set(),
): Map<string, TimelineItem> {
  // Índice por tipo + dimensiones normalizadas (ancho/alto pueden venir
  // girados): evita comparar cada local contra toda la página del timeline.
  const buckets = new Map<string, TimelineItem[]>();
  for (const remote of remoteItems) {
    if (claimedRemoteIds.has(remote.id)) continue;
    const key = `${remote.mediaType}|${Math.min(remote.width, remote.height)}x${Math.max(
      remote.width,
      remote.height,
    )}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(remote);
    else buckets.set(key, [remote]);
  }

  const candidatesByLocal = new Map<string, TimelineItem[]>();
  const localsByRemote = new Map<string, string[]>();

  for (const local of localAssets) {
    const key = `${local.mediaType}|${Math.min(local.width, local.height)}x${Math.max(
      local.width,
      local.height,
    )}`;
    const bucket = buckets.get(key);
    if (!bucket) continue;
    for (const remote of bucket) {
      if (Math.abs(remote.takenAt - local.creationTime) > MATCH_WINDOW_MS) continue;
      // En video la duración desambigua ráfagas con las mismas dimensiones.
      if (
        local.mediaType === "video" &&
        Math.abs((remote.durationMs ?? 0) - (local.durationMs ?? 0)) > 1000
      ) {
        continue;
      }

      const candidates = candidatesByLocal.get(local.id);
      if (candidates) candidates.push(remote);
      else candidatesByLocal.set(local.id, [remote]);

      const locals = localsByRemote.get(remote.id);
      if (locals) locals.push(local.id);
      else localsByRemote.set(remote.id, [local.id]);
    }
  }

  const matches = new Map<string, TimelineItem>();
  for (const [localId, candidates] of candidatesByLocal) {
    if (candidates.length !== 1) continue;
    const remote = candidates[0];
    if (localsByRemote.get(remote.id)?.length !== 1) continue;
    matches.set(localId, remote);
  }
  return matches;
}

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

  // Reinstalación: la cola está vacía y no hay sha local que enlace con la
  // nube. Emparejar por metadatos evita el tile duplicado local+remoto.
  const metadataMatches = matchLocalToRemote(
    localAssets.filter((a) => !claimedLocal.has(a.id)),
    remoteItems,
    claimedRemote,
  );

  for (const a of localAssets) {
    if (claimedLocal.has(a.id)) continue;
    const matched = metadataMatches.get(a.id);
    if (matched) {
      claimedRemote.add(matched.id);
      photos.push({
        key: `l-${a.id}`,
        syncStatus: "SYNCED",
        progress: null,
        takenAt: matched.takenAt,
        mediaType: matched.mediaType,
        width: matched.width,
        height: matched.height,
        durationMs: matched.durationMs,
        localUri: a.uri,
        thumbUrl: matched.thumbUrl,
        thumbhash: matched.thumbhash,
        remoteId: matched.id,
        assetId: a.id,
        albumId: a.albumId ?? null,
        queueItem: null,
        remote: matched,
      });
      continue;
    }
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
  const groups: { label: string; photos: HybridPhoto[] }[] = [];
  for (const photo of photos) {
    const label = sectionLabel(photo.takenAt, now);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.photos.push(photo);
    else groups.push({ label, photos: [photo] });
  }

  const rows: GalleryRow[] = [];
  for (const group of groups) {
    rows.push({
      type: "header",
      key: `h-${group.label}`,
      label: group.label,
      location: resolvePredominantLocation(group.photos),
    });
    for (const photo of group.photos) {
      rows.push({ type: "photo", key: photo.key, photo });
    }
  }
  return rows;
}
