---

#### `docs/fases/02_r2_descargas_cache.md`
```markdown
# Fase 2: Descargas y Reglas de Caché R2

## 🎯 Objetivo
Permitir descargas individuales en móvil/web y descargas por lote en ZIP sin sobrepasar la memoria del Worker (128 MB), aplicando cabeceras CDN inmutables.

## 📂 Archivos a Modificar / Crear
1. `apps/api/src/routes/media.ts`
2. `apps/mobile/src/app/media/[id].tsx`
3. `apps/mobile/src/web/batch-download.ts` (Nuevo)

## 🛠️ Especificaciones Técnicas

### 1. Endpoint en API (`apps/api/src/routes/media.ts`)
- Implementar `GET /api/media/:id/download`:
  - Validar propiedad del archivo por `userId`.
  - Generar URL GET prefirmada con:
    `ResponseContentDisposition: attachment; filename="${encodeURIComponent(media.originalFilename)}"`
- En endpoints que devuelven blobs o miniaturas directamente:
  - Setear cabecera: `Cache-Control: public, max-age=31536000, immutable`.

### 2. Descarga en Cliente Móvil (`apps/mobile/src/app/media/[id].tsx`)
- Añadir botón de descarga en el visor de foto:
  - En **Native (iOS/Android)**: Usar `FileSystem.downloadAsync(downloadUrl, localUri)` y luego `MediaLibrary.saveToLibraryAsync(localUri)`.
  - En **Web**: Crear un enlace invisible `<a download="..." href="...">` y simular el `.click()`.

### 3. Descarga por Lotes Web (`apps/mobile/src/web/batch-download.ts`)
- Utilizar `client-zip` (ligero y sin dependencias pesadas de Node):
  - Descargar streams de las fotos seleccionadas con un límite de concurrencia de 3 peticiones simultáneas.
  - Generar el blob ZIP en el navegador y disparar la descarga directa de `fotos-exportadas.zip`.

## 🧪 Verificación Local
- Test unitario simulado con Vitest validando que `/api/media/:id/download` incluya el header `attachment`.