import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { getQueueOwner, initializeQueue } from "./db";
import { processQueue } from "./processor";
import { scanLibrary } from "./scanner";

export const BACKUP_TASK = "photos-backup-sync";

/**
 * iOS decide cuándo ejecutar la tarea; procesamos un lote acotado por tiempo.
 * Esto debe llamarse antes de registrar la tarea (en el arranque del app).
 *
 * Headless no hay sesión React: la cola está particionada por usuario, así que
 * se restaura el último dueño guardado por initializeQueue. Sin dueño (nunca
 * hubo sesión o se cerró) no hay nada que procesar — las filas quedan
 * selladas con su user_id.
 */
TaskManager.defineTask(BACKUP_TASK, async () => {
  try {
    const owner = getQueueOwner();
    if (!owner) return BackgroundTask.BackgroundTaskResult.Success;
    await initializeQueue(owner);
    await scanLibrary();
    await processQueue({ deadlineMs: Date.now() + 25_000 });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackupTask(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    await BackgroundTask.registerTaskAsync(BACKUP_TASK, { minimumInterval: 15 });
  } catch {
    // sin background disponible (simulador, restricciones) — el respaldo sigue en primer plano
  }
}
