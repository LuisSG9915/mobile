import type {
  AdminStorageResponse,
  CheckHashesResponse,
  DownloadResponse,
  FavoriteResponse,
  MediaDetail,
  Stats,
  TimelineFilter,
  TimelineMonthsResponse,
  TimelineResponse,
  TrashResponse,
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

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(await getAuthHeaders())) {
    headers.set(key, value);
  }
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
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

  trash: (): Promise<TrashResponse> => apiFetch("/v1/trash").then((r) => r.json()),

  stats: (): Promise<Stats> => apiFetch("/v1/stats").then((r) => r.json()),

  adminStorage: (): Promise<AdminStorageResponse> =>
    apiFetch("/v1/admin/storage").then((r) => r.json()),
};
