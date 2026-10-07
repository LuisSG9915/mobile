---

#### `docs/fases/04_liberar_espacio.md`
```markdown
# Fase 4: Funcionalidad "Liberar Espacio en el Dispositivo"

## 🎯 Objetivo
Permitir al usuario eliminar de su almacenamiento local únicamente aquellas fotos que ya estén respaldadas e íntegras en la nube.

## 📂 Archivos a Modificar / Crear
1. `apps/mobile/src/lib/free-up-space.ts` (Nuevo)
2. `apps/mobile/src/app/(tabs)/settings.tsx`
3. `apps/mobile/src/lib/use-hybrid-gallery.ts`

## 🛠️ Especificaciones Técnicas

### 1. Algoritmo en `free-up-space.ts`
1. Listar activos locales mediante `MediaLibrary.getAssetsAsync`.
2. Para cada archivo local, consultar el estado local en la tabla/IndexedDB de sincronización.
3. Filtrar aquellos donde `status === 'synced'` y el `sha256` exista confirmado en la base de datos local.
4. Sumar el tamaño de dichos archivos (`recoverableBytes`).
5. Función `executeFreeUpSpace()`:
   - Llamar `MediaLibrary.deleteAssetsAsync(assetIds)`.
   - Marcar el registro local como `remote_only: true` para que la galería no lo borre visualmente del timeline, sino que comience a solicitar la miniatura desde R2/CDN.

### 2. Interfaz en `settings.tsx`
- Card destacada: **Liberar espacio del teléfono**.
- Mostrar texto: *"Tienes {formatBytes(recoverableBytes)} respaldados en la nube que puedes borrar de tu teléfono de forma segura."*
- Botón: `Liberar espacio`. Diálogo de confirmación nativo antes de ejecutar.

## 🧪 Verificación Local
- Test unitario simulando una lista de 5 assets (3 sincronizados, 2 pendientes). Verificar que solo los 3 sincronizados sean enviados a eliminación.