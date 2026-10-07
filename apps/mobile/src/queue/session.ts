import { useEffect, useState } from "react";
import { useSession } from "../auth/client";
import { closeQueue, initializeQueue } from "./db";

/**
 * Ciclo de vida de la cola nativa atado a la sesión (misma firma que
 * session.web.ts, que además abre IndexedDB por usuario):
 *
 * - Con usuario: fija el dueño de la cola SQLite (user_id) y adopta las filas
 *   sin dueño heredadas de antes del scoping. `ready` pasa a true al terminar.
 * - Sin usuario (logout o expirada): suelta el contexto — las filas quedan
 *   selladas con su user_id y no se procesan bajo otra cuenta.
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
