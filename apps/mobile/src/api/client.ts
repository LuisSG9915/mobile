import type {
  MediaDetail,
  Stats,
  TimelineResponse,
  UploadInitInput,
  UploadInitResponse,
} from "@photos/shared";
import { API_URL, authClient } from "../auth/client";

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
  const cookie = await authClient.getCookie();
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
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
  initUpload: (body: UploadInitInput): Promise<UploadInitResponse> =>
    apiFetch("/v1/uploads/init", { method: "POST", body: JSON.stringify(body) }).then((r) =>
      r.json(),
    ),

  completeUpload: (id: string): Promise<{ id: string; status: "ready" }> =>
    apiFetch(`/v1/uploads/${id}/complete`, { method: "POST" }).then((r) => r.json()),

  timeline: (cursor?: string, limit = 60): Promise<TimelineResponse> => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor) q.set("cursor", cursor);
    return apiFetch(`/v1/timeline?${q}`).then((r) => r.json());
  },

  mediaDetail: (id: string): Promise<MediaDetail> =>
    apiFetch(`/v1/media/${id}`).then((r) => r.json()),

  deleteMedia: (id: string): Promise<{ ok: true }> =>
    apiFetch(`/v1/media/${id}`, { method: "DELETE" }).then((r) => r.json()),

  restoreMedia: (id: string): Promise<{ ok: true }> =>
    apiFetch(`/v1/media/${id}/restore`, { method: "POST" }).then((r) => r.json()),

  trash: (): Promise<TimelineResponse> => apiFetch("/v1/trash").then((r) => r.json()),

  stats: (): Promise<Stats> => apiFetch("/v1/stats").then((r) => r.json()),
};
