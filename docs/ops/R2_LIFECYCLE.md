# Ciclo de vida de R2 (MPUs huérfanas)

> Plan v2 · H1.1. Cloudflare R2 cobra el almacenamiento de las partes de una
> subida multipart hasta que se completa o se aborta. Si el cliente desaparece
> (app desinstalada, red perdida, pestaña cerrada), la MPU queda in-progress.

## Regla recomendada

Abortar automáticamente las MPUs incompletas a los **7 días**:

```bash
# Bucket de producción y de desarrollo
node node_modules/wrangler/bin/wrangler.js r2 bucket lifecycle add photos-media \
  abort-incomplete-mpu --abort-multipart-days 7
node node_modules/wrangler/bin/wrangler.js r2 bucket lifecycle add photos-media-dev \
  abort-incomplete-mpu --abort-multipart-days 7

# Verificar
node node_modules/wrangler/bin/wrangler.js r2 bucket lifecycle list photos-media
```

La API de R2 expone lo mismo como `AbortIncompleteMultipartUpload`; si se prefiere
el dashboard: **R2 → bucket → Settings → Object lifecycle rules → Add rule →
Abort incomplete multipart uploads after 7 days**.

## Limpieza de la aplicación

`runCleanup` ejecuta `abortStaleMultipartUploads` (>24 h) con paginación de
`ListMultipartUploads` (máximo 10 páginas por corrida). La lifecycle rule es la
red de seguridad para las MPUs que caen fuera de la ventana del cron.

## Qué NO hace

- No borra objetos ya completados (eso lo decide el usuario con papelera/cuota).
- No sustituye el `abortMultipartUpload` explícito del cliente al cancelar; ese
  sigue siendo la vía rápida.

## Verificación

- Subir un archivo > 20 MB, matar la app a mitad y comprobar que a las 24 h el
  cron lo aborta (o a los 7 días la lifecycle rule).
- `wrangler r2 bucket lifecycle list photos-media` debe mostrar la regla.
