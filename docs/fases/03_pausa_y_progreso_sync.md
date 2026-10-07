# Fase 3: Pausa Persistente de la Sincronización y Anillo de Progreso

## 🎯 Objetivo

Dar al usuario control manual del respaldo con un botón de **pausa persistente** (la pausa sobrevive a reinicios de la app y **nunca** se auto-reanuda) y visualizar el avance en bytes de la cola con el anillo de estado en el avatar, estilo Google Photos.

## 📂 Archivos a Modificar / Crear

1. `apps/mobile/src/queue/types.ts`
2. `apps/mobile/src/queue/progress.ts`
3. `apps/mobile/src/queue/db.ts` y `db.web.ts` (flag en `kv`)
4. `apps/mobile/src/queue/processor.ts` y `processor.web.ts`
5. `apps/mobile/src/queue/runner.ts` y `runner.web.ts`
6. `apps/mobile/src/lib/store.ts`
7. `apps/mobile/src/ui/SyncStatusAvatar.tsx`
8. `apps/mobile/src/app/(tabs)/backup.tsx`
9. `apps/mobile/src/i18n/es.ts`

## 🛠️ Especificaciones Técnicas

### 1. Flag de pausa persistente (`queue/db.ts` / `db.web.ts`)

- Persistir la preferencia en el almacén `kv` existente (tabla `kv` en SQLite nativo; prefijo `photos.kv.` en localStorage web) con la clave `backup.paused` (`"1"`/`"0"`).
- Exportar la misma API en ambas plataformas: `isBackupPaused(): boolean` y `setBackupPaused(v: boolean): void`.

### 2. Runner sin auto-resume (`runner.ts` / `runner.web.ts`)

- `useBackupRunner` ya re-dispara `runBackupPass()` al abrir la app, al volver de background y cada 60 s. Antes de llamar `processQueue()`, consultar `isBackupPaused()`:
  - Si está pausado: ejecutar `scanLibrary()` (la cola sigue reflejando lo pendiente) pero **no** procesar.
  - La pausa jamás se limpia sola: solo `setBackupPaused(false)` desde el botón "Reanudar" la quita.
- El procesador chequea el flag **entre ítems**: el archivo en vuelo termina su PUT, el siguiente no arranca. No abortar requests a medias.
- Web: tras `setBackupPaused` emitir el evento de cola (`useQueueEvents.emit()`) para que la pestaña que tiene el Web Lock `photos.queue.process:<userId>` se entere vía BroadcastChannel `photos.queue` y detenga su bucle.

### 3. Estado y UI

- `SyncProgressStatus` ya incluye `'paused'` y `computeSyncProgress(items, running)` devuelve `paused` cuando `running === false` con `filesRemaining > 0` y sin fallos. El `running` que publica el procesador debe reflejar `!isBackupPaused()`.
- Botón **Pausar respaldo** / **Reanudar respaldo** en `app/(tabs)/backup.tsx` (junto a la barra de progreso) y dentro del modal del `SyncStatusAvatar`. Texto del estado cuando está en pausa: `t.backup.paused` ("Respaldo en pausa") ya existe en `i18n/es.ts`; agregar las keys de los botones.
- El anillo muestra estado `paused` (icono de pausa sobre el avatar) en lugar de `syncing`.

## 🧪 Verificación Local

- Test de `computeSyncProgress`: cola con pendientes + `running=false` → `status === 'paused'`.
- Test de persistencia: pausar, "reiniciar" (nueva instancia del store kv) y verificar que `isBackupPaused()` sigue `true` y `runBackupPass()` no invoca `processQueue`.
- Test web: `setBackupPaused(true)` en una pestaña detiene el procesamiento de la pestaña que posee el lock.
