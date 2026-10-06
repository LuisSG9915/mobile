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
pnpm --filter @photos/mobile web             # expo start --web (localhost:8081)
pnpm --filter @photos/mobile build:web       # expo export -p web -> apps/mobile/dist
pnpm --filter @photos/mobile deploy:web      # build + wrangler deploy (worker photos-web, assets estáticos SPA)

# Pruebas
pnpm test:all                  # todas las capas -> test-results/<runId>/ + REPORT.md (exit 1 si algo ejecutado falla)
pnpm test:pipeline             # selftest del runner/reporte (node:test + fixtures, sin wrangler/R2)
pnpm test:report               # regenera el reporte de una corrida (node scripts/test-report.mjs <dir>)
pnpm --filter @photos/mobile test        # vitest + happy-dom (módulos *.web.ts)
pnpm --filter @photos/mobile test:e2e    # Playwright (levanta wrangler + expo web solos)
```

Guía completa y checklist nativo: `docs/testing/PLAN_PRUEBAS.md`. Hallazgos curados: `docs/testing/findings.json`.

## Soporte web

La app Expo también corre en navegador. Particularidades:

- **Auth web = Bearer**: en el navegador no hay SecureStore y las cookies de terceros las bloquean los navegadores. El API expone `set-auth-token` (plugin `bearer` de better-auth) y el cliente web lo guarda en localStorage y lo manda como `Authorization: Bearer`. Orígenes web permitidos: var `WEB_ORIGINS` del API (CORS + trustedOrigins).
- **Sin expo-sqlite en web**: la cola web persiste en IndexedDB `photos.queue` (metadatos en `items` + archivo como ArrayBuffer en `files`, por usuario; `web/queue-store.ts` con `queue/db.web.ts` como proyección en memoria). Sobrevive a recargas y cierres de pestaña; se suspende si la sesión expira y se BORRA al cerrar sesión confirmado (`queue/logout.web.ts`). El procesamiento es exclusivo por pestaña vía Web Locks (`navigator.locks`, nombre `photos.queue.process:<userId>`) y un BroadcastChannel `photos.queue` refresca la proyección entre pestañas. kv va a localStorage.
- **Variantes de plataforma con sufijo `.web.ts`**: `auth/client.web.ts`, `queue/{db,background,scanner,processor}.web.ts`. Deben exportar exactamente la misma API que el archivo nativo (tsc chequea ambos contra el `.ts`). Lógica solo-web en `src/web/` con imports explícitos.
- **Subida web**: selector `<input type="file">` (`src/web/files.ts`), SHA-256 con `@noble/hashes`, miniatura WebP + thumbhash con canvas (`src/web/thumb.ts`), PUT con XHR (`src/web/upload.ts`). Safari no codifica WebP; Chrome no decodifica HEIC/HEVC.
- **CORS de R2**: para que el PUT prefirmado funcione desde el navegador, aplicar `apps/api/r2-cors.json` a `photos-media` y `photos-media-dev` (`wrangler r2 bucket cors set <bucket> --file apps/api/r2-cors.json` o dashboard), agregando el origen de producción en `allowed.origins`.
- **R2 remoto en dev**: el binding `BUCKET` de `wrangler dev` es `remote: true` (bucket `photos-media-dev`); si fuera local, `/complete` no encontraría los objetos subidos vía URL prefirmada y devolvería 409. Los tests (`vitest`) quedan locales por `remoteBindings: false` en `vitest.config.ts`. Requiere `wrangler login`.
- **Wrangler se invoca por ruta directa**: el shim `apps/api/node_modules/.bin/wrangler` está roto con el linker hoisted en Windows, así que los scripts de package.json llaman `node ../../node_modules/wrangler/bin/wrangler.js` (el paquete vive hoisted en la raíz). NO "arreglar" los scripts de vuelta a `wrangler …` desnudo: falla.
- **vars de producción vs dev**: `vars` en `apps/api/wrangler.jsonc` lleva los valores de PRODUCCIÓN (`BETTER_AUTH_URL`, `WEB_ORIGINS` → `*.luis-sg9915.workers.dev`); en `wrangler dev` los sobrescribe `.dev.vars` (localhost). Si se añade un var que difiere dev/prod, definir ambos lados.
- **build:web/deploy:web exigen API de producción**: `apps/mobile/scripts/check-web-env.mjs` aborta si `EXPO_PUBLIC_API_URL` no está definida o no es https/no-localhost (env del proceso > `.env`). `deploy:web` = check + `expo export -p web` + `wrangler deploy` del worker `photos-web` (assets `dist/`, SPA fallback).

## Reglas

- NO ejecutar `assembleDebug` / builds nativos salvo que sea estrictamente necesario (cambios en deps nativas). Se usa dev-client y se compila una sola vez.
- El Worker NUNCA recibe binarios de fotos/videos. Todo va directo a R2 con URLs prefirmadas.
- Claves R2: `users/{userId}/thumbs/{sha256}.webp` y `users/{userId}/originals/{sha256}.{ext}`.
- Miniaturas: WebP, lado mayor 400px, máximo 50KB.
- Secrets nunca al repo. En local: `apps/api/.dev.vars` (gitignored). Ejemplo en `.dev.vars.example`.
- aws-sdk S3 contra R2 requiere `requestChecksumCalculation: "WHEN_REQUIRED"` en el S3Client.
- Antes de `pnpm add`/`pnpm install` en este repo, detener `expo start`: con `node-linker=hoisted` en Windows pnpm falla con `ERR_PNPM_ENOENT ..._tmp_...` si el dev server tiene `node_modules` abierto (pnpm/pnpm#12880).
- Idioma de la UI y mensajes de error visibles al usuario: español.
- Lint/format con Biome (`pnpm lint:fix` antes de commits).
