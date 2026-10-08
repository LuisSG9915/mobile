import type {
  AdminStorageResponse,
  AlbumDetailResponse,
  AlbumListResponse,
  AutoTagBatchResponse,
  AutoTagResponse,
  CheckHashesResponse,
  CleanerBurstsResponse,
  CleanerCleanupInput,
  CleanerCleanupResponse,
  CreateAlbumInput,
  DownloadResponse,
  EmptyTrashResponse,
  FavoriteResponse,
  LocationsQuery,
  LocationsResponse,
  MediaDetail,
  MemoriesResponse,
  PlacesResponse,
  PublicAlbumResponse,
  SearchQuery,
  SearchResponse,
  ShareAlbumResponse,
  Stats,
  StorageResponse,
  TagsResponse,
  TimelineFilter,
  TimelineMonthsResponse,
  TimelineResponse,
  TrashResponse,
  UpdateAlbumInput,
  UpdateMediaInput,
  UploadInitInput,
  UploadInitResponse,
} from "@photos/shared";
import { API_URL, getAuthHeaders } from "../auth/client";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Tope de espera para llamadas JSON al API. No usa AbortSignal.timeout (soporte
 * irregular fuera de navegadores modernos): una carrera que rechaza a los 30 s
 * basta — la petición huérfana resuelve tarde sin efectos. El `signal` del
 * caller sigue pasando al fetch para cancelación real.
 */
const API_TIMEOUT_MS = 30_000;

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(await getAuthHeaders())) {
    headers.set(key, value);
  }
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const res = await Promise.race([
    fetch(`${API_URL}${path}`, { ...init, headers }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("La solicitud tardó demasiado. Revisa tu conexión.")),
        API_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  if (!res.ok) {
    let code = "unknown";
    let message = "Algo salió mal.";
    try {
      const body = await res.json();
      code = body.error ?? code;
      message = body.message ?? message;
    } catch {}
    throw new ApiError(res.status, code, message);
  }
  return res;
}

export const api = {
  initUpload: (
    body: UploadInitInput,
    opts?: { signal?: AbortSignal },
  ): Promise<UploadInitResponse> =>
    apiFetch("/v1/uploads/init", {
      method: "POST",
      body: JSON.stringify(body),
      signal: opts?.signal,
    }).then((r) => r.json()),

  checkHashes: (sha256: string[], opts?: { signal?: AbortSignal }): Promise<CheckHashesResponse> =>
    apiFetch("/v1/uploads/check-hashes", {
      method: "POST",
      body: JSON.stringify({ sha256 }),
      signal: opts?.signal,
    }).then((r) => r.json()),

  completeUpload: (
    id: string,
    opts?: { signal?: AbortSignal },
  ): Promise<{ id: string; status: "ready" }> =>
    apiFetch(`/v1/uploads/${id}/complete`, { method: "POST", signal: opts?.signal }).then((r) =>
      r.json(),
    ),

  timeline: (
    cursor?: string,
    limit = 60,
    filter: TimelineFilter = "all",
  ): Promise<TimelineResponse> => {
    const q = new URLSearchParams({ limit: String(limit), filter });
    if (cursor) q.set("cursor", cursor);
    return apiFetch(`/v1/timeline?${q}`).then((r) => r.json());
  },

  timelineMonths: (): Promise<TimelineMonthsResponse> =>
    apiFetch("/v1/timeline/months").then((r) => r.json()),

  memories: (monthDay?: string): Promise<MemoriesResponse> => {
    const q = new URLSearchParams();
    if (monthDay) q.set("monthDay", monthDay);
    const qs = q.toString();
    return apiFetch(`/v1/timeline/memories${qs ? `?${qs}` : ""}`).then((r) => r.json());
  },

  mediaDetail: (id: string): Promise<MediaDetail> =>
    apiFetch(`/v1/media/${id}`).then((r) => r.json()),

  downloadMedia: (id: string): Promise<DownloadResponse> =>
    apiFetch(`/v1/media/${id}/download`).then((r) => r.json()),

  deleteMedia: (id: string): Promise<{ ok: true }> =>
    apiFetch(`/v1/media/${id}`, { method: "DELETE" }).then((r) => r.json()),

  restoreMedia: (id: string): Promise<{ ok: true }> =>
    apiFetch(`/v1/media/${id}/restore`, { method: "POST" }).then((r) => r.json()),

  toggleFavorite: (id: string): Promise<FavoriteResponse> =>
    apiFetch(`/v1/media/${id}/favorite`, { method: "POST" }).then((r) => r.json()),

  autoTagMedia: (id: string): Promise<AutoTagResponse> =>
    apiFetch(`/v1/media/${id}/auto-tag`, { method: "POST" }).then((r) => r.json()),

  autoTagBatch: (): Promise<AutoTagBatchResponse> =>
    apiFetch("/v1/media/auto-tag-batch", { method: "POST" }).then((r) => r.json()),

  trash: (): Promise<TrashResponse> => apiFetch("/v1/trash").then((r) => r.json()),

  emptyTrash: (): Promise<EmptyTrashResponse> =>
    apiFetch("/v1/trash/empty", { method: "POST" }).then((r) => r.json()),

  stats: (): Promise<Stats> => apiFetch("/v1/stats").then((r) => r.json()),

  userStorage: (): Promise<StorageResponse> => apiFetch("/v1/user/storage").then((r) => r.json()),

  adminStorage: (): Promise<AdminStorageResponse> =>
    apiFetch("/v1/admin/storage").then((r) => r.json()),

  // Álbumes y Compartir
  albums: (): Promise<AlbumListResponse> => apiFetch("/v1/albums").then((r) => r.json()),

  createAlbum: (body: CreateAlbumInput): Promise<AlbumDetailResponse> =>
    apiFetch("/v1/albums", { method: "POST", body: JSON.stringify(body) }).then((r) => r.json()),

  albumDetail: (id: string): Promise<AlbumDetailResponse> =>
    apiFetch(`/v1/albums/${id}`).then((r) => r.json()),

  updateAlbum: (id: string, body: UpdateAlbumInput): Promise<AlbumDetailResponse> =>
    apiFetch(`/v1/albums/${id}`, { method: "PATCH", body: JSON.stringify(body) }).then((r) =>
      r.json(),
    ),

  deleteAlbum: (id: string): Promise<{ ok: true }> =>
    apiFetch(`/v1/albums/${id}`, { method: "DELETE" }).then((r) => r.json()),

  addAlbumMedia: (id: string, mediaIds: string[]): Promise<{ ok: true }> =>
    apiFetch(`/v1/albums/${id}/media`, { method: "POST", body: JSON.stringify({ mediaIds }) }).then(
      (r) => r.json(),
    ),

  removeAlbumMedia: (id: string, mediaId: string): Promise<{ ok: true }> =>
    apiFetch(`/v1/albums/${id}/media/${mediaId}`, { method: "DELETE" }).then((r) => r.json()),

  shareAlbum: (id: string): Promise<ShareAlbumResponse> =>
    apiFetch(`/v1/albums/${id}/share`, { method: "POST" }).then((r) => r.json()),

  unshareAlbum: (id: string): Promise<{ ok: true }> =>
    apiFetch(`/v1/albums/${id}/share`, { method: "DELETE" }).then((r) => r.json()),

  publicSharedAlbum: (token: string): Promise<PublicAlbumResponse> =>
    apiFetch(`/v1/shared/album/${token}`).then((r) => r.json()),

  // Búsqueda, etiquetas y metadatos
  updateMedia: (id: string, body: UpdateMediaInput): Promise<MediaDetail> =>
    apiFetch(`/v1/media/${id}`, { method: "PATCH", body: JSON.stringify(body) }).then((r) =>
      r.json(),
    ),

  search: (query: SearchQuery): Promise<SearchResponse> => {
    const q = new URLSearchParams();
    if (query.q) q.set("q", query.q);
    if (query.tag) q.set("tag", query.tag);
    if (query.filter && query.filter !== "all") q.set("filter", query.filter);
    if (query.dateFrom) q.set("dateFrom", query.dateFrom);
    if (query.dateTo) q.set("dateTo", query.dateTo);
    if (query.minBytes != null) q.set("minBytes", String(query.minBytes));
    if (query.maxBytes != null) q.set("maxBytes", String(query.maxBytes));
    if (query.cursor) q.set("cursor", query.cursor);
    if (query.limit) q.set("limit", String(query.limit));
    return apiFetch(`/v1/search?${q}`).then((r) => r.json());
  },

  tags: (): Promise<TagsResponse> => apiFetch("/v1/tags").then((r) => r.json()),

  locations: (query?: LocationsQuery): Promise<LocationsResponse> => {
    const q = new URLSearchParams();
    if (query?.minLat != null) q.set("minLat", String(query.minLat));
    if (query?.maxLat != null) q.set("maxLat", String(query.maxLat));
    if (query?.minLng != null) q.set("minLng", String(query.minLng));
    if (query?.maxLng != null) q.set("maxLng", String(query.maxLng));
    if (query?.filter && query.filter !== "all") q.set("filter", query.filter);
    const qs = q.toString();
    return apiFetch(`/v1/locations${qs ? `?${qs}` : ""}`).then((r) => r.json());
  },

  places: (): Promise<PlacesResponse> => apiFetch("/v1/locations/places").then((r) => r.json()),

  geocodeBatch: (): Promise<{ geocoded: number }> =>
    apiFetch("/v1/locations/geocode-batch", { method: "POST" }).then((r) => r.json()),

  cleanerBursts: (): Promise<CleanerBurstsResponse> =>
    apiFetch("/v1/cleaner/bursts").then((r) => r.json()),

  cleanerCleanup: (body: CleanerCleanupInput): Promise<CleanerCleanupResponse> =>
    apiFetch("/v1/cleaner/cleanup", { method: "POST", body: JSON.stringify(body) }).then((r) =>
      r.json(),
    ),
};
