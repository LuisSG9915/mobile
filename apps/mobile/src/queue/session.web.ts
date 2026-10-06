import { useEffect, useState } from "react";
import { useSession } from "../auth/client";
import { t } from "../i18n/es";
import { closeQueue, initializeQueue } from "./db";

/**
 * Ciclo de vida de la cola web atado a la sesión:
 *
 * - Con usuario: comprueba soporte (IndexedDB + Web Locks) y abre la cola
 *   (`ready` pasa a true al terminar la hidratación desde IndexedDB).
 * - Sin usuario (logout o sesión expirada): suspende la cola con closeQueue —
 *   los pendientes quedan en IndexedDB y se recuperan si vuelve la MISMA
 *   cuenta (el borrado solo ocurre en el logout explícito, queue/logout.web.ts).
 */
export function useQueueSession(): { ready: boolean; error: string | null } {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!userId) {
      setReady(false);
      void closeQueue();
      return;
    }
    if (typeof indexedDB === "undefined" || typeof navigator.locks?.request !== "function") {
      setReady(false);
      setError(t.queue.unsupported);
      return;
    }
    setReady(false);
    setError(null);
    initializeQueue(userId)
      .then(() => {
        if (active) setReady(true);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [userId]);

  return { ready, error };
}
