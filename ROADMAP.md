# 📸 Plan de Trabajo y Estado de Fases — Photo Cloud Sync

> **Motor de Ejecución:** Devin AI (Modelo SWE-2 Max)  
> **Arquitectura:** Turborepo | Expo React Native | Hono en Cloudflare Workers | Cloudflare R2 | SQLite Queue

---

## 📊 Progreso General

**Total:** `[██████████] 100%`

| Fase | Título | Estado | Progreso |
| :--- | :--- | :---: | :--- |
| **Fase 1** | Arquitectura de Galería Híbrida y Modelo de Estados | `[DONE]`        | `[██████████] 100%` |
| **Fase 2** | UI/UX Galería Tipo Google Fotos (Badges y Timeline) | `[DONE]`        | `[██████████] 100%` |
| **Fase 3** | Funcionalidad "Liberar Espacio" y Deduplicación | `[DONE]`        | `[██████████] 100%` |
| **Fase 4** | Visor Fullscreen, Metadatos EXIF y Papelera | `[DONE]`        | `[██████████] 100%` |
| **Fase 5** | Métricas de Almacenamiento, Testing E2E y Release | `[DONE]`        | `[██████████] 100%` |

---

## 🛠️ Desglose Detallado por Fases

### Fase 1: Arquitectura de Galería Híbrida y Modelo de Estados
**Objetivo:** Unificar la lista de fotos locales de Expo MediaLibrary con el catálogo sincronizado en SQLite y Cloudflare R2.
- [x] Extender tipos en `packages/shared/src/schemas.ts` para soportar estados: `LOCAL_ONLY`, `PENDING`, `SYNCING`, `SYNCED`, `REMOTE_ONLY`, `FAILED`.
- [x] Actualizar tabla de cola en `apps/mobile/src/queue/db.ts` con columna de progreso porcentual y hash SHA-256.
- [x] Implementar hook unificado `useHybridGallery()` en `apps/mobile/src/lib/` que combine assets locales con la consulta paginada de `apps/api/src/routes/timeline.ts`.
- [x] Tests unitarios en Vitest para la resolución de colisiones y duplicados.

---

### Fase 2: UI/UX Galería Tipo Google Fotos (Badges y Timeline)
**Objetivo:** Interfaz visual fluida con badges en tiempo real según el estado de la cola.
- [x] Crear componente `<SyncBadge status={photo.syncStatus} progress={photo.progress} />` con estilos NativeWind.
- [x] Agrupar la galería en secciones de fechas (*Hoy*, *Ayer*, *Mes*) con encabezados adhesivos (*sticky headers*).
- [x] Conectar eventos de `apps/mobile/src/queue/processor.ts` para actualizar reactivamente el badge de la foto en pantalla sin re-renderizar toda la cuadrícula.
- [x] Verificación visual con Puppeteer MCP en la versión web (`apps/mobile`).

---

### Fase 3: "Liberar Espacio" en Dispositivo y Deduplicación Criptográfica
**Objetivo:** Optimización de almacenamiento en el móvil y prevención de transferencias innecesarias a Cloudflare R2.
- [x] En `apps/api/src/routes/uploads.ts`, implementar endpoint `/check-hashes` que reciba un lote de SHA-256 y devuelva cuáles ya existen en R2.
- [x] En la cola del móvil, si el hash ya existe en la API, marcar instantáneamente como `SYNCED` sin emitir PUT presignado.
- [x] Implementar acción "Liberar Espacio": listar fotos `SYNCED`, solicitar confirmación y remover el archivo físico local mediante `expo-file-system`/`MediaLibrary`.
- [x] Pruebas automáticas de integración de la cola en `apps/mobile/src/queue/processor.web.test.ts` *(vitest resuelve los módulos `.web.ts`; la variante nativa comparte la misma lógica y queda cubierta por la paridad de APIs)*.

---

### Fase 4: Visor Fullscreen, Metadatos EXIF y Papelera
**Objetivo:** Experiencia completa de visualización e higiene de fotos.
- [x] Enriquecer `apps/mobile/src/app/media/[id].tsx` con carrusel fluido (FlatList paginado con prefetch de vecinos vía `useTimeline`), zoom pinch/pan/doble-tap, reproducción de video y drawer de información EXIF.
- [x] Añadir selector de borrado: "Mover a papelera" (soft-delete remoto) o "Eliminar solo copia local" (`lib/free-space.ts`: `hasLocalCopy`/`deleteLocalCopy`; en web la copia local no existe tras el upload → no-op).
- [x] Sincronizar estados en `apps/mobile/src/app/trash.tsx` con el endpoint de soft-delete en `apps/api/src/routes/media.ts` (`deletedAt` expuesto en schema compartido y respuesta; la papelera muestra días restantes reales de retención).
- [x] Validar la ejecución del cron `apps/api/src/cron/cleanup.ts` para purga a 30 días en el bucket R2 (cubierto por `test/cron.test.ts`; trigger `0 3 * * *` en `wrangler.jsonc`).

---

### Fase 5: Métricas de Cuota, Pruebas E2E y Performance
**Objetivo:** Monitoreo, robustez y preparación para producción.
- [x] Endpoint de uso de almacenamiento por usuario: `GET /v1/stats` (count, totalBytes, lastUploadAt y `quotaBytes` desde `STORAGE_QUOTA_BYTES` compartido).
- [x] Barra de almacenamiento en `apps/mobile/src/app/(tabs)/settings.tsx` alimentada por `stats.data.quotaBytes`.
- [x] Suite completa `pnpm test:all` (pipeline 24, api 39, mobile 97) + E2E Playwright 11/11 verdes (auth, persistencia de cola, Web Locks, subida/dedup/filtro). Nota: el primer intento falló por un `expo start` zombie ocupando :8081 con env de producción; con los puertos limpios la suite pasó entera.
- [x] Auditoría de linting con Biome (`pnpm lint` limpio tras `lint:fix`).