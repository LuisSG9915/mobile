# Fase 5: Experiencia UI/UX Google Photos

## 🎯 Objetivo
Implementar los tres gestos principales de navegación de Google Photos: Fast-Scrubber, Pinch-to-Zoom y Drag-to-Select.

## 📂 Archivos a Modificar / Crear
1. `apps/mobile/src/ui/FastScrubber.tsx` (Nuevo)
2. `apps/mobile/src/ui/PinchGrid.tsx` o extender `use-hybrid-gallery.ts`
3. `apps/mobile/src/app/(tabs)/index.tsx`

## 🛠️ Especificaciones Técnicas

### 1. Fast-Scrubber Lateral (`FastScrubber.tsx`)
- Indicador delgado en el borde derecho de la pantalla.
- Al arrastrar el dedo (`PanGestureHandler`):
  - Calcular la posición porcentual de la lista.
  - Mostrar una etiqueta flotante estilo burbuja (`badge`) con el texto del mes y año (ej. `Septiembre 2026`).
  - Invocar `flatListRef.current.scrollToIndex(...)` calculando el grupo de fecha más cercano.

### 2. Pinch-to-Zoom (Densidad de Cuadrícula)
- Usar `PinchGestureHandler`:
  - Detectar escala:
    - Escala > 1.2: Reducir columnas (de 3 a 1 columna - detalle).
    - Escala < 0.8: Aumentar columnas (de 3 a 5 columnas - vista compacta).
  - Animar suavemente el cambio de `numColumns` o escala del layout.

### 3. Drag-to-Select (Selección Múltiple Continua)
- Al hacer *long-press* sobre una foto, se activa `isSelectionMode = true` y se selecciona esa foto.
- Mientras el usuario mantenga el dedo en pantalla y se desplace sobre otras fotos, agregarlas automáticamente al conjunto `selectedIds`.
- Barra superior contextual: *"X seleccionadas"*, botón de "Descargar seleccionadas" y botón de "Eliminar".

## 🧪 Verificación Local
- Validar fluidez a 60 FPS en web y emulador sin bloqueos del hilo principal.