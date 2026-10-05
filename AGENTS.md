# AGENTS.md — Photos Platform

Monorepo pnpm + Turborepo. Dos apps: `apps/api` (Worker Hono + D1 + R2) y `apps/mobile` (Expo/React Native). Paquete compartido: `packages/shared` (`@photos/shared`).

## Comandos

```bash
pnpm install                 # instalar todo
pnpm lint                    # biome check
pnpm lint:fix                # biome check --write
pnpm typecheck               # tsc --noEmit en todos los paquetes (via turbo)
pnpm test                    # tests (via turbo)

# API
pnpm --filter @photos/api dev                # wrangler dev (localhost:8787)
pnpm --filter @photos/api test               # vitest con @cloudflare/vitest-pool-workers (Miniflare)
pnpm --filter @photos/api test:live          # test contra R2 real (requiere env R2_*)
pnpm --filter @photos/api db:generate        # drizzle-kit generate -> migrations/
pnpm --filter @photos/api db:migrate:local   # wrangler d1 migrations apply photos-db --local
pnpm --filter @photos/api db:migrate:remote  # wrangler d1 migrations apply photos-db --remote
pnpm --filter @photos/api cf-typegen         # wrangler types -> worker-configuration.d.ts

# Mobile
pnpm --filter @photos/mobile start           # expo start --dev-client
```

## Reglas

- NO ejecutar `assembleDebug` / builds nativos salvo que sea estrictamente necesario (cambios en deps nativas). Se usa dev-client y se compila una sola vez.
- El Worker NUNCA recibe binarios de fotos/videos. Todo va directo a R2 con URLs prefirmadas.
- Claves R2: `users/{userId}/thumbs/{sha256}.webp` y `users/{userId}/originals/{sha256}.{ext}`.
- Miniaturas: WebP, lado mayor 400px, máximo 50KB.
- Secrets nunca al repo. En local: `apps/api/.dev.vars` (gitignored). Ejemplo en `.dev.vars.example`.
- aws-sdk S3 contra R2 requiere `requestChecksumCalculation: "WHEN_REQUIRED"` en el S3Client.
- Idioma de la UI y mensajes de error visibles al usuario: español.
- Lint/format con Biome (`pnpm lint:fix` antes de commits).
