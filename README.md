# Photos Platform

Respaldo y galería personal de fotos y videos.

- **Storage**: Cloudflare R2 (cero egress). Los binarios van directo del cliente a R2 con URLs prefirmadas — el Worker nunca toca bytes de media.
- **Metadata**: Cloudflare D1 (SQLite).
- **API**: Cloudflare Workers + Hono + OpenAPI (docs interactivas con Scalar en `/docs`).
- **Auth**: Better Auth (email/password) en D1 vía Drizzle.
- **App**: Expo / React Native + NativeWind, galería con FlashList y placeholders ThumbHash, cola de respaldo en segundo plano.

## Setup

1. `corepack enable && pnpm install`
2. Crear recursos: `wrangler d1 create photos-db`, `wrangler r2 bucket create photos-media` (+ `photos-media-dev`), token de API de R2 (Object Read & Write sobre esos buckets).
3. `cp apps/api/.dev.vars.example apps/api/.dev.vars` y rellenar.
4. `pnpm --filter @photos/api db:migrate:local`
5. `pnpm --filter @photos/api dev` y `pnpm --filter @photos/mobile start`

Ver `AGENTS.md` para comandos y convenciones.

## Flujo de subida

```
App → POST /v1/uploads/init (sha256 + metadatos)
    ← URLs prefirmadas (thumb + original)  o  "duplicate"
App → PUT directo a R2 (thumb .webp, original)
App → POST /v1/uploads/:id/complete  (verifica head() en R2)
    ← item listo; aparece en GET /v1/timeline
```

## Funcionalidades

- **Deduplicación SHA-256**: `check-hashes` + índice único `(user_id, sha256)` en D1; los duplicados no re-suben bytes. Cuota de 10 GB por usuario en `user_storage_stats` (`GET /v1/user/storage`).
- **Descargas**: `GET /v1/media/:id/download` devuelve URL prefirmada con `Content-Disposition: attachment`; las lecturas prefirmadas llevan `Cache-Control: immutable`. En nativo se guarda al carrete; en web, `<a download>` o ZIP en lote (`fotos-exportadas.zip`, concurrencia 3).
- **Progreso de sync reactivo**: proyección byte-a-byte de la cola en store Zustand (`SyncProgressState`), anillo de progreso SVG en el avatar del header y barra en la pestaña Respaldo.
- **Liberar espacio**: borra del dispositivo solo lo confirmado en la nube (`done`/`duplicate` + `remote_id` + `sha256`); la galería sigue mostrando esos items como `REMOTE_ONLY` vía miniaturas remotas.
- **Gestos Google Photos**: fast-scrubber lateral con burbuja mes/año, pinch-to-zoom con densidades 1/3/5 columnas, drag-to-select con barra contextual (descargar / mover a papelera) y selección por día.

## Pruebas

Todo el pipeline corre **100% offline** (`remoteBindings: false` en `apps/api/vitest.config.ts`): D1 vía migraciones en Miniflare y R2 efímero en memoria.

```bash
pnpm lint         # Biome
pnpm typecheck    # tsc --noEmit en todos los paquetes
pnpm test         # API (Miniflare) + mobile (happy-dom) vía turbo
```

Estado actual: 46 tests API + 116 tests mobile, todos verdes sin llamadas externas a Cloudflare. El plan de fases y sus commits viven en `docs/PLAN_GENERAL.md`.

## Distribución

APK público para GitHub Releases / Obtainium / repo F-Droid propio:

```bash
cd apps/mobile
npx eas-cli build -p android --profile release-apk
```

El profile `release-apk` firma con el keystore gestionado por EAS y hornea `EXPO_PUBLIC_API_URL` apuntando al API de producción.

## Licencia

[AGPL-3.0](LICENSE) para todo el monorepo (app, API y `shared`). Quien despliegue una versión modificada del API como servicio debe publicar sus cambios.
