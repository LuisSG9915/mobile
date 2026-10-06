/**
 * Tipos compartidos de la cola de respaldo. Los importan db.ts (SQLite nativo)
 * y db.web.ts (IndexedDB), que los re-exportan para no romper a los callers.
 */
export type QueueState =
  | "queued"
  | "hashing"
  | "thumbnailing"
  | "init"
  | "uploading_thumb"
  | "uploading_original"
  | "completing"
  | "done"
  | "duplicate"
  | "failed";

export type QueueItem = {
  asset_id: string;
  uri: string;
  filename: string | null;
  media_type: "photo" | "video";
  created_at: number; // ms, fecha de captura del asset
  state: QueueState;
  sha256: string | null;
  remote_id: string | null;
  attempts: number;
  last_error: string | null;
  bytes_total: number;
  bytes_sent: number;
  updated_at: number;
};

export type QueueStats = { total: number; done: number; pending: number; failed: number };
