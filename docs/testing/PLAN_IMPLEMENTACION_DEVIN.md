# 🚀 PLAN DE IMPLEMENTACIÓN TÉCNICA - ROADMAP DEV SWE-2

## 📌 Directivas Operativas para el Agente SWE-2
1. **Gestión de Estados**: Cada fase debe actualizarse en este archivo al completarse.
   - Estado pendiente: `[ ] Pendiente`
   - Estado completado: `[x] Completado (Commit: <hash>)`
2. **Enfoque de Commits**: Realizar commits atómicos y descriptivos al finalizar cada sub-tarea.
3. **⚠️ REGLA DE ORO DE CONSUMO Y COSTOS ($0 Cloud Spending)**:
   - **PROHIBIDO** lanzar tests contra la infraestructura real de Cloudflare (D1 o R2 en producción).
   - Todos los tests de la API deben ejecutarse usando emulación local con **Miniflare** (`wrangler dev --local` o mocks de `@cloudflare/workers-types`).
   - Las operaciones de R2 en tests deben ser mockeadas utilizando un mock en memoria o almacenamiento local efímero.
   - Ejecutar `pnpm test` asegurando que no se requieran credenciales activas de Cloudflare ni se envíen peticiones HTTP externas.

---

## 📋 Control de Fases

- [ ] **Fase 1: Esquema de Datos Optimizado, Deduplicación y Cuota en D1**
- [ ] **Fase 2: Optimización de R2, Streaming y Descarga de Archivos**
- [ ] **Fase 3: Monitor de Progreso en Vivo y Anillo de Sincronización**
- [ ] **Fase 4: Funcionalidad "Liberar Espacio" en el Dispositivo**
- [ ] **Fase 5: Experiencia UI/UX Google Photos (Scrubber, Zoom, Drag-Select)**
- [ ] **Fase 6: Pruebas E2E Locales, Pipeline de Validación y Documentación**

---

### Detalle de Fases

### 🔹 Fase 1: Esquema de Datos Optimizado, Deduplicación y Cuota en D1
* **Objetivo**: Garantizar consultas D1 en $O(\log N)$ para timelines extensos y deduplicar archivos.
* **Tareas**:
  - [ ] Actualizar `apps/api/src/db/schema.ts` incorporando:
    - `date_group` (texto YYYY-MM-DD indexado).
    - `thumbhash` o `blurhash`.
    - `sha256` con índice único por usuario para evitar cargas duplicadas.
    - Tabla `user_storage_stats` para tracking instantáneo de cuota sin `SUM()`.
  - [ ] Generar y aplicar migraciones D1 con `drizzle-kit generate`.
  - [ ] Modificar endpoint `/api/uploads/presign` para recibir `sha256`:
    - Si el hash ya existe para el usuario, retornar inmediatamente el medio existente con código `200 { status: 'already_exists', media }`.
  - [ ] Crear endpoint `GET /api/user/storage` para consultar el porcentaje de almacenamiento usado.
* **Criterio de Aceptación**:
  - Tests unitarios en `apps/api/test/` validan deduplicación y cálculo de cuota sin invocar la nube.

---

### 🔹 Fase 2: Optimización de R2, Streaming y Descarga de Archivos
* **Objetivo**: Permitir descargas de fotos individuales y por lote, optimizando la capa de entrega.
* **Tareas**:
  - [ ] Endpoint de descarga individual en API: `GET /api/media/:id/download` que genere una URL prefirmada GET de R2 con cabecera `response-content-disposition: attachment; filename="..."`.
  - [ ] Implementar soporte en el cliente móvil (`apps/mobile/src/app/media/[id].tsx`):
    - Botón "Descargar".
    - Guardado en el carrete mediante `expo-file-system` y `expo-media-library`.
  - [ ] Implementar descarga múltiple en Web:
    - Módulo cliente en `apps/mobile/src/web/batch-download.ts` que reciba una lista de URLs de fotos, las solicite en paralelo controlado y las empaquete con `client-zip` en un único archivo ZIP descargable.
  - [ ] Configurar cabeceras de respuesta `Cache-Control: public, max-age=31536000, immutable` para activos servidos vía Worker.
* **Criterio de Aceptación**:
  - Descarga individual funcional en Web y Mobile; descarga de 5 fotos comprimidas en un ZIP en web sin superar los límites de memoria.

---

### 🔹 Fase 3: Monitor de Progreso en Vivo y Anillo de Sincronización
* **Objetivo**: Brindar feedback visual continuo del progreso de respaldo y estado general.
* **Tareas**:
  - [ ] Extender el gestor de subidas en `apps/mobile/src/queue/`:
    - Implementar seguimiento de progreso byte a byte (mediante `uploadAsync` en mobile y `xhr.upload.onprogress` en web).
    - Exponer a través de Zustand/Context los valores: `bytesUploaded`, `totalBytes`, `currentFileIndex`, `totalFilesCount`, `uploadState` ('idle' | 'uploading' | 'completed' | 'paused' | 'error').
  - [ ] Crear componente `SyncStatusAvatar.tsx` en el encabezado principal:
    - Anillo SVG/Canvas que anima el porcentaje `0% - 100%`.
    - Checkmark verde al finalizar (`completed`).
    - Al presionar, abrir modal con desglose detallado de la copia de seguridad.
  - [ ] Agregar barra de progreso en `apps/mobile/src/app/(tabs)/backup.tsx`.
* **Criterio de Aceptación**:
  - Durante una simulación de subida de 10 archivos, el anillo se actualiza gradualmente y el modal refleja el conteo exacto de fotos y bytes.

---

### 🔹 Fase 4: Funcionalidad "Liberar Espacio" en el Dispositivo
* **Objetivo**: Permitir al usuario borrar de su dispositivo las fotos que ya están respaldadas en R2.
* **Tareas**:
  - [ ] Crear utilidad `apps/mobile/src/lib/free-up-space.ts`:
    - Obtener lista de IDs locales y sus hashes SHA-256.
    - Comparar contra la base de datos local y verificar su estado confirmado en la nube.
    - Calcular el tamaño total recuperable en bytes.
  - [ ] Crear pantalla/modal "Liberar Espacio":
    - Mostrar: *"Puedes liberar X.X GB de tu dispositivo. Estos elementos ya están respaldados"*.
    - Botón de acción: *"Liberar X.X GB"*.
  - [ ] Ejecutar `MediaLibrary.deleteAssetsAsync` en Android/iOS con confirmación del sistema.
  - [ ] Mantener los elementos visibles en el timeline usando sus miniaturas remotas o en caché.
* **Criterio de Aceptación**:
  - Test en entorno mockeado donde solo los archivos sincronizados son eliminados localmente.

---

### 🔹 Fase 5: Experiencia UI/UX Google Photos (Scrubber, Zoom, Drag-Select)
* **Objetivo**: Replicar la ergonomía e interacción característica de Google Photos.
* **Tareas**:
  - [ ] **Fast-Scrubber Lateral**:
    - Componente de barra de arrastre lateral que calcule la posición relativa respecto a los `date_group` del timeline.
    - Muestra burbuja flotante estilizada con `Mes Año` al arrastrar.
  - [ ] **Pinch-to-Zoom Grid**:
    - Integrar `react-native-gesture-handler` para alternar entre 1 columna (día detallado), 3 columnas (estándar) y 5 columnas (mes compacto).
  - [ ] **Drag-to-Select**:
    - Al mantener presionado un elemento, habilitar selección múltiple continua mediante arrastre del dedo.
  - [ ] **Sticky Headers**:
    - Encabezados de fecha fijados en la parte superior con checkbox para seleccionar todo el día.
* **Criterio de Aceptación**:
  - Navegación fluida por gestos sin saltos de fotogramas ni bloqueos de hilo principal en web y móvil.

---

### 🔹 Fase 6: Pruebas E2E Locales, Pipeline de Validación y Documentación
* **Objetivo**: Asegurar cero regresiones y verificar el cumplimiento de pruebas sin costo.
* **Tareas**:
  - [ ] Actualizar suite de tests en `apps/api/test/` para cubrir los nuevos endpoints con Miniflare local.
  - [ ] Añadir tests de integración en `apps/mobile/` para la cola de progreso y la lógica de liberación de espacio.
  - [ ] Ejecutar el pipeline de scripts `pnpm lint`, `pnpm typecheck` y `pnpm test`.
  - [ ] Actualizar `README.md` y `ROADMAP.md` documentando las nuevas capacidades.
* **Criterio de Aceptación**:
  - Cobertura de tests aprobada al 100% en local sin credenciales externas de Cloudflare.