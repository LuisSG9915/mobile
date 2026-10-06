// En web no hay tareas en segundo plano del SO; el runner en primer plano
// (runner.ts) cubre el procesamiento mientras la pestaña está abierta.
export const BACKUP_TASK = "photos-backup-sync";

export async function registerBackupTask(): Promise<void> {}
