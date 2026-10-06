import { signOut } from "../auth/client";
import { queryClient } from "../lib/query-client";
import { wipeUserQueue } from "../web/queue-store";
import { closeQueue } from "./db";
import { cancelQueue } from "./processor";

/**
 * Logout explícito en web. Orden:
 *
 * 1. cancelQueue(): aborta la pasada en curso (XHR/fetch señalados).
 * 2. wipeUserQueue(userId): borra items + archivos + cuenta de ESTE usuario —
 *    los pendientes locales no deben quedar en el navegador tras cerrar sesión.
 * 3. closeQueue(): drena la cadena de escrituras, suelta el contexto y cierra IDB.
 * 4. queryClient.clear(): limpia la caché de datos remotos (privacidad entre cuentas).
 * 5. signOut(): cierra la sesión y borra el token Bearer (auth/client.web.ts).
 */
export async function performLogout(userId: string): Promise<void> {
  cancelQueue();
  // Mejor esfuerzo: si IndexedDB falla, la sesión igualmente debe cerrarse.
  try {
    await wipeUserQueue(userId);
  } catch {}
  await closeQueue().catch(() => {});
  queryClient.clear();
  await signOut();
}
