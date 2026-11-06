import { t } from "../i18n/es";
import { formatBytes, formatDuration } from "../lib/format";
import type { SyncProgressState } from "./types";

export type UploadNotificationText = {
  title: string;
  body: string;
  /** Progreso 0–100 para la barra de la notificación. */
  percent: number;
};

/**
 * Texto de la notificación persistente de respaldo. Vive fuera de
 * `foreground.ts` para poder testearlo sin cargar el módulo nativo.
 *
 * No incluye el nombre del archivo: la notificación se ve en la pantalla de
 * bloqueo y el nombre puede ser sensible. Solo cuenta y velocidad.
 */
export function describeUploadNotification(state: SyncProgressState): UploadNotificationText {
  const percent =
    state.totalBytes > 0
      ? clampPercent((state.bytesUploaded / state.totalBytes) * 100)
      : state.filesTotal > 0
        ? clampPercent(((state.filesTotal - state.filesRemaining) / state.filesTotal) * 100)
        : 0;

  if (state.filesRemaining <= 0) {
    return {
      title: t.backup.notificationTitle,
      body: t.backup.notificationPreparing,
      percent,
    };
  }

  const progress = t.backup.notificationProgress(
    state.filesTotal - state.filesRemaining,
    state.filesTotal,
  );
  const rate =
    state.status === "syncing" && state.bytesPerSecond > 0
      ? t.syncP.rate(
          formatBytes(state.bytesPerSecond),
          formatDuration(state.etaSeconds != null ? state.etaSeconds * 1000 : null),
        )
      : null;

  return {
    title: t.backup.notificationTitle,
    body: [progress, `${percent}%`, rate].filter(Boolean).join(" · "),
    percent,
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}
