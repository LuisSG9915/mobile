import { signOut } from "../auth/client";
import { closeQueue } from "./db";

/**
 * Nativo: la cola en SQLite NO se borra al cerrar sesión (los pendientes del
 * usuario siguen en el dispositivo para su próxima sesión). Solo se cierra la
 * sesión y se suelta la cola. Misma firma que logout.web.ts.
 */
export async function performLogout(_userId: string): Promise<void> {
  await signOut();
  await closeQueue().catch(() => {});
}
