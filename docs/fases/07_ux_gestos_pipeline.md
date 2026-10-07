# Fase 7: Gestos del Timeline/Visor y Pipeline Final $0

## 🎯 Objetivo

Pulir la ergonomía estilo Google Photos — Fast-Scrubber, Pinch-to-Zoom, Drag-to-Select y Swipe-down para cerrar el visor — y ejecutar el pipeline de validación completo en local, **sin emitir una sola llamada de red a Cloudflare**.

## 📂 Archivos a Modificar / Crear

1. `apps/mobile/src/ui/FastScrubber.tsx`
2. `apps/mobile/src/app/(tabs)/index.tsx`
3. `apps/mobile/src/app/media/[id].tsx`
4. `apps/mobile/src/lib/grid-geometry.ts`
5. `apps/mobile/src/i18n/es.ts`

## 🛠️ Especificaciones Técnicas

### 1. Fast-Scrubber Lateral (`FastScrubber.tsx`)

- Indicador delgado en el borde derecho; al arrastrar (`PanGestureHandler`):
  - Calcular la posición porcentual de la lista.
  - Burbuja flotante con `Mes Año` (ej. `Septiembre 2026`).
  - `flatListRef.scrollToIndex(...)` al grupo de fecha más cercano.

### 2. Pinch-to-Zoom (densidad de cuadrícula)

- `Gesture.Pinch()` sobre el grid (`(tabs)/index.tsx`), densidades `DENSITY_LEVELS = [1, 3, 5]`:
  - `scale > 1.2` → menos columnas (zoom in, hasta detalle 1 columna).
  - `scale < 0.8` → más columnas (zoom out, hasta compacta 5).
- Persistir `gridColumns` en el store de settings; animar el cambio de `numColumns`.

### 3. Drag-to-Select (selección continua)

- Long-press sobre una foto activa `isSelectionMode` y la selecciona.
- Mantener el dedo y desplazarse agrega ítems al `selectedIds` resolviendo posición con `hitTestPhoto` de `grid-geometry.ts`.
- Barra contextual: *"X seleccionadas"* + acciones **Descargar** (usa `download-many` / `web/batch-download.ts`) y **Eliminar** (a papelera).

### 4. Swipe-down en el visor (`media/[id].tsx`)

- `Gesture.Pan()` vertical cierra el visor con `router.back()`, animando traslación + opacidad/escala proporcional al arrastre.
- Solo se activa cuando la imagen está sin zoom (`scale === 1`); con zoom activo el pan sigue moviendo la imagen (coexistir con el `pinch`/`doubleTap` ya presentes vía `Gesture.Simultaneous` / umbrales).

### 5. Pipeline final — Regla de oro $0

- Ejecutar en orden y dejar todo verde:
  ```bash
  pnpm lint
  pnpm typecheck
  pnpm test
  pnpm test:pipeline
  ```
- **PROHIBIDO** `--remote` y credenciales de Cloudflare: API tests con Miniflare (`vitest.config.ts` con `remoteBindings: false`), mobile con happy-dom, e2e con `test:e2e` local.
- Al cerrar: marcar cada fase `[x]` con su hash en `docs/PLAN_GENERAL.md` y actualizar `README.md`/`AGENTS.md` si cambiaron capacidades.

## 🧪 Verificación Local

- 60 FPS en web y emulador sin bloqueos del hilo principal.
- Suite completa verde sin acceso a red externa ni objetos R2 reales.
