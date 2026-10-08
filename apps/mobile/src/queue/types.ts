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
  /** Solo nativo: dueño de la fila (la web proyecta sin este campo). */
  user_id?: string | null;
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

/** Opciones para el escaneo de biblioteca. */
export type ScanOptions = { forceScan?: boolean };

/** Resultado del scan de biblioteca: encolados + omitidos por formato. */
export type ScanResult = { added: number; skipped: number };

export type SyncProgressStatus = "idle" | "syncing" | "completed" | "paused" | "error";

/**
 * Proyección agregada de la cola para el anillo de sincronización del avatar
 * y la barra de progreso de Respaldo. Se recalcula con cada tick de la cola.
 */
export type SyncProgressState = {
  bytesUploaded: number;
  totalBytes: number;
  filesTotal: number;
  filesRemaining: number;
  currentFileName: string;
  status: SyncProgressStatus;
};
