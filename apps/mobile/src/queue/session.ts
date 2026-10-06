/**
 * Nativo: la cola vive en SQLite, disponible de inmediato y sin ciclo de vida
 * ligado a la sesión. Misma firma que session.web.ts (la variante web abre
 * IndexedDB por usuario y suspende la cola al expirar la sesión).
 */
export function useQueueSession(): { ready: boolean; error: string | null } {
  return { ready: true, error: null };
}
