import type { MediaManifestItem } from "@photos/shared";
import * as SQLite from "expo-sqlite";
import type { RestoreItem, RestoreItemState } from "./plan";
import type { RestoreCounts, RestoreStore } from "./processor";

const DDL = `
CREATE TABLE IF NOT EXISTS restore_queue (
  user_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  ext TEXT NOT NULL,
  media_type TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  mismatches INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, remote_id)
);
CREATE INDEX IF NOT EXISTS restore_queue_state ON restore_queue(user_id, state);
`;

let db: SQLite.SQLiteDatabase | null = null;
function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    // Base propia: no toca la cola de subida ni su limpieza al cerrar sesión.
    db = SQLite.openDatabaseSync("photos_restore.db");
    db.execSync(DDL);
  }
  return db;
}

type Row = {
  remote_id: string;
  sha256: string;
  file_size: number;
  ext: string;
  media_type: "photo" | "video";
  taken_at: number;
  state: RestoreItemState;
  attempts: number;
  mismatches: number;
  last_error: string | null;
};

const COLUMN: Record<string, string> = {
  state: "state",
  attempts: "attempts",
  mismatches: "mismatches",
  lastError: "last_error",
};

/** Cola de restauración persistente por usuario; sobrevive a cerrar la app. */
export function createRestoreStore(userId: string): RestoreStore {
  return {
    enqueue(items: MediaManifestItem[], state: RestoreItemState = "queued") {
      const d = getDb();
      const now = Date.now();
      d.withTransactionSync(() => {
        for (const m of items) {
          d.runSync(
            `INSERT OR IGNORE INTO restore_queue
               (user_id, remote_id, sha256, file_size, ext, media_type, taken_at, state, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, m.id, m.sha256, m.fileSize, m.ext, m.mediaType, m.takenAt, state, now],
          );
        }
      });
    },
    next(): RestoreItem | null {
      const r = getDb().getFirstSync<Row>(
        "SELECT * FROM restore_queue WHERE user_id = ? AND state = 'queued' ORDER BY taken_at DESC LIMIT 1",
        [userId],
      );
      if (!r) return null;
      return {
        remoteId: r.remote_id,
        sha256: r.sha256,
        fileSize: r.file_size,
        ext: r.ext,
        mediaType: r.media_type,
        takenAt: r.taken_at,
        state: r.state,
        attempts: r.attempts,
        mismatches: r.mismatches,
        lastError: r.last_error,
      };
    },
    update(remoteId, patch) {
      const sets: string[] = [];
      const args: (string | number | null)[] = [];
      for (const [k, v] of Object.entries(patch)) {
        const col = COLUMN[k];
        if (col === undefined || v === undefined) continue;
        sets.push(`${col} = ?`);
        args.push(v as string | number | null);
      }
      if (sets.length === 0) return;
      sets.push("updated_at = ?");
      args.push(Date.now(), userId, remoteId);
      getDb().runSync(
        `UPDATE restore_queue SET ${sets.join(", ")} WHERE user_id = ? AND remote_id = ?`,
        args,
      );
    },
    counts(): RestoreCounts {
      const c: RestoreCounts = {
        queued: 0,
        downloading: 0,
        verifying: 0,
        done: 0,
        skipped_local: 0,
        failed: 0,
        corrupt: 0,
      };
      const rows = getDb().getAllSync<{ state: RestoreItemState; n: number }>(
        "SELECT state, COUNT(*) AS n FROM restore_queue WHERE user_id = ? GROUP BY state",
        [userId],
      );
      for (const r of rows) c[r.state] = r.n;
      return c;
    },
    retryFailed() {
      // También rescata los que quedaron a medias si la app se cerró durante la descarga.
      getDb().runSync(
        `UPDATE restore_queue SET state = 'queued', attempts = 0, mismatches = 0, last_error = NULL, updated_at = ?
         WHERE user_id = ? AND state IN ('failed','corrupt','downloading','verifying')`,
        [Date.now(), userId],
      );
    },
    clear() {
      getDb().runSync("DELETE FROM restore_queue WHERE user_id = ?", [userId]);
    },
  };
}

/** SHA-256 ya conocidos de este teléfono (calculados por la cola de subida). */
export function localKnownShas(queueDb: SQLite.SQLiteDatabase, userId: string): Set<string> {
  const rows = queueDb.getAllSync<{ sha256: string }>(
    "SELECT DISTINCT sha256 FROM queue WHERE user_id IS ? AND sha256 IS NOT NULL",
    [userId],
  );
  return new Set(rows.map((r) => r.sha256.toLowerCase()));
}
