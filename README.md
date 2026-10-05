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
