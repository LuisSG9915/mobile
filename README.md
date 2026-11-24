# Photos Platform

Respaldo y galería personal de fotos y videos.

- **Storage**: Cloudflare R2 (cero egress). Los binarios van directo del cliente a R2 con URLs prefirmadas — el Worker nunca toca bytes de media.
- **Metadata**: Cloudflare D1 (SQLite).
- **API**: Cloudflare Workers + Hono + OpenAPI (docs interactivas con Scalar en `/docs`).
- **Auth**: Better Auth (email/password) en D1 vía Drizzle.
- **App**: Expo / React Native + NativeWind, galería con FlashList y placeholders ThumbHash, cola de respaldo en segundo plano.

## Setup

1. Node 20/22 LTS (corepack). `corepack enable && pnpm install`
2. `wrangler login` (o token de API) y luego crear recursos: `wrangler d1 create photos-db`, `wrangler r2 bucket create photos-media` (+ `photos-media-dev`), token de API de R2 (Object Read & Write sobre esos buckets).
3. Copiar `apps/api/.dev.vars.example` a `apps/api/.dev.vars` y rellenar: `R2_ACCOUNT_ID`, claves R2, `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), Resend opcional.
4. Crear `apps/mobile/.env` desde `apps/mobile/.env.example` y definir `EXPO_PUBLIC_API_URL` (local: IP LAN o `adb reverse tcp:8787 tcp:8787`; prod: URL https).
5. `pnpm --filter @photos/api db:migrate:local`
6. Requisito previo para móvil: tener un development build instalado en el emulador/dispositivo (`npx expo run:android` o EAS profile `development`). `expo start --dev-client` no compila la app.
7. `pnpm --filter @photos/api dev` y `pnpm --filter @photos/mobile start`

Ver [AGENTS.md](AGENTS.md) para comandos y convenciones.

## Flujo de subida

```text
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
- **Gestos Google Photos**: fast-scrubber lateral con burbuja mes/año, pinch-to-zoom con densidades 1/3/5 columnas, drag-to-select con barra contextual (descargar / añadir a álbum / mover a papelera) y selección por día.
- **Respaldo en segundo plano (Android)**: foreground service `dataSync` mantiene la cola al minimizar, con notificación de progreso y pausa por límite de 6 h (Android 15).
- **Salto temporal**: chip «Desde <mes> · N elementos» con Ver todas y carrusel con alcance `before`.

## Pruebas

Todo el pipeline corre **100% offline** (`remoteBindings: false` en `apps/api/vitest.config.ts`): D1 vía migraciones en Miniflare y R2 efímero en memoria.

```bash
pnpm lint         # Biome
pnpm typecheck    # tsc --noEmit en todos los paquetes
pnpm test         # API (Miniflare) + mobile (happy-dom) vía turbo
```

Estado actual: suites de tests API + mobile + pipeline, todos verdes sin llamadas externas a Cloudflare. Ver CI para conteos actualizados. El plan vigente (v2, H1 en curso) y su evidencia viven en [docs/PLAN_MEJORAS.md](docs/PLAN_MEJORAS.md); [docs/PLAN_GENERAL.md](docs/PLAN_GENERAL.md) es histórico.

## Web

La app también corre en navegador. Comandos:

```bash
pnpm --filter @photos/mobile web        # dev
pnpm --filter @photos/mobile build:web  # export estático
pnpm --filter @photos/mobile deploy:web # build + deploy (worker photos-web)
```

Requisitos: `EXPO_PUBLIC_API_URL` https/no-localhost (ver `apps/mobile/scripts/check-web-env.mjs`); CORS de R2 aplicado a `photos-media`/`photos-media-dev` con `wrangler r2 bucket cors set <bucket> --file apps/api/r2-cors.json` incluyendo el origen de producción.

Notas web (ver [AGENTS.md](AGENTS.md)): la cola persiste en IndexedDB `photos.queue` (metadatos + ArrayBuffer), exclusividad por pestaña vía Web Locks, refresco entre pestañas por BroadcastChannel, suspensión si la sesión expira y borrado al cerrar sesión confirmado. Codecs: Safari no codifica WebP; Chrome no decodifica HEIC/HEVC. Auth web = Bearer (`set-auth-token`, localStorage; cookies de terceros bloqueadas) y variantes `.web.ts` (misma API que el nativo). Ver [AGENTS.md](AGENTS.md#soporte-web) (Soporte web).

## Distribución

El APK se publica en **GitHub Releases** (ver [releases](https://github.com/LuisSG9915/mobile/releases)). Dos formas de instalarlo:

- **Directo**: descargar `photos-*.apk` del último release e instalarlo.
- **Obtainium** (recomendado, FOSS): instalar [Obtainium](https://github.com/ImranR98/Obtainium) y añadir la URL `https://github.com/LuisSG9915/mobile` — detecta y auto-actualiza desde los releases.

### Publicar un release

El binario lo produce **Gradle**, no EAS (plan gratuito agotado). El flujo canónico está en [docs/ops/RELEASE.md](docs/ops/RELEASE.md).

Automático vía workflow (`.github/workflows/release-apk.yml`), disparado por push de tag `v*`:

```bash
pnpm release:check --tag v1.2.0
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin main --tags
```

Requiere los secrets `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD` (keystore propia `photos-release.keystore`) y la variable `vars.EXPO_PUBLIC_API_URL`. La firma debe ser siempre la misma para que Android permita actualizar in-place y Obtainium funcione.

Manual / local: ver §2 de [docs/ops/RELEASE.md](docs/ops/RELEASE.md) (`expo prebuild` + `scripts/android-prepare.mjs` + `gradlew assembleRelease`).

## Licencia

[AGPL-3.0](LICENSE) para todo el monorepo (app, API y `shared`). Quien despliegue una versión modificada del API como servicio debe publicar sus cambios.
