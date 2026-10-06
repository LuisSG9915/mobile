import "fake-indexeddb/auto";

/**
 * fake-indexeddb instala `indexedDB` como global de módulo compartido por toda
 * la suite: las BD persisten entre tests aunque se haga vi.resetModules().
 * Para aislar tests que usan la cola web (queue/db.web.ts -> web/queue-store.ts):
 *
 *   1. `await closeQueue()` del módulo "./db" ya importado (cierra la conexión
 *      IDB abierta por el test anterior) — borrar la BD con la conexión viva
 *      deja el deleteDatabase bloqueado.
 *   2. `await deleteDb()`: promisificar indexedDB.deleteDatabase("photos.queue").
 *   3. `vi.resetModules()` y re-importar los módulos bajo prueba.
 *   4. `await db.initializeQueue("<userId>")` para fijar el contexto activo.
 */

/**
 * Web Locks: processor.web.ts exige navigator.locks.request. happy-dom expone
 * `navigator.locks` como getter que devuelve null SIN setter (una asignación
 * `navigator.locks = …` lanzaría en ESM), así que hay que redefinir la
 * propiedad. Si el entorno ya trae una implementación real, se respeta.
 * El stub concede siempre el lock (los tests single-thread se serializan
 * solos); para simular "otra pestaña lo tiene" se espía request devolviendo
 * callback(null).
 */
if (typeof navigator !== "undefined" && typeof navigator.locks?.request !== "function") {
  const request = (
    name: string,
    optionsOrCallback: { mode?: string } | ((lock: unknown) => unknown),
    callback?: (lock: unknown) => unknown,
  ): Promise<unknown> => {
    const cb = callback ?? (optionsOrCallback as (lock: unknown) => unknown);
    const mode =
      typeof optionsOrCallback === "object" && optionsOrCallback !== null
        ? (optionsOrCallback.mode ?? "exclusive")
        : "exclusive";
    return Promise.resolve(cb({ name, mode }));
  };
  Object.defineProperty(navigator, "locks", {
    value: { request },
    writable: true,
    configurable: true,
  });
}
