import { signOut } from "../auth/client";
import { closeQueue } from "./db";
import { cancelQueue } from "./processor";

/**
 * Nativo: la cola en SQLite NO se borra al cerrar sesión (los pendientes del
 * usuario quedan sellados con su user_id y retoman si vuelve a entrar — ya no
 * se procesan bajo otra cuenta). Se cancela la pasada en vuelo, se suelta el
 * contexto y se cierra la sesión. Misma firma que logout.web.ts.
 */
export async function performLogout(_userId: string): Promise<void> {
  cancelQueue();
  await signOut();
  await closeQueue().catch(() => {});
}
