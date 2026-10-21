# Observabilidad (Sentry)

La telemetría es **opcional y apagada por defecto**: sin DSN no se inicializa el
SDK y no se envía nada. Cuando se configura, captura:

- Errores no controlados del JS móvil y de React Native.
- Errores de render atrapados por el `ErrorBoundary` global (`app/_layout.tsx`).
- Errores 500 del Worker (`app.onError` de Hono).
- Errores no controlados de `fetch`/`scheduled` del Worker vía `withSentry`.

No se envían fotos, rutas de archivos, emails ni contenido de la galería. En
móvil solo se asocia el `user.id` (`setTelemetryUser`) para poder cruzar un
reporte con una cuenta; nunca el email.

## Móvil

1. El proyecto actual es **`photos`** (org `cb-5d`, plataforma `react-native`).
   El DSN vive en `apps/mobile/.env` (gitignored):

```ini
EXPO_PUBLIC_SENTRY_DSN=https://<key>@o<orgId>.ingest.sentry.io/<projectId>
EXPO_PUBLIC_SENTRY_ENVIRONMENT=production
```

2. **Recompila** el dev-client/APK: `@sentry/react-native` es un módulo nativo
   y el config plugin ya está en `app.json`. Un OTA no basta para la primera
   instalación.
3. Para stack traces legibles (source maps), `SENTRY_ORG=cb-5d` y
   `SENTRY_PROJECT=photos` ya están en `eas.json`. Falta el token como secreto
   de EAS (nunca en el repo):

```bash
cd apps/mobile
npx eas-cli env:create --name SENTRY_AUTH_TOKEN --value <token> \
  --visibility secret --scope project
```

El `SENTRY_AUTH_TOKEN` de `apps/mobile/.env` solo sirve para builds locales;
EAS no sube ese archivo.

Comprobación rápida: con el DSN puesto, ejecuta

```bash
pnpm check:sentry
```

Envía un evento de prueba al endpoint de ingesta (sin abrir la app) y te dice
el id. Búscalo en Sentry con el tag `source:check-sentry`. También puedes lanzar
un error desde el boundary o provocar un `throw` en desarrollo.

## Worker

El SDK ya está en el código (`withSentry` + `captureException` en `onError`).
Solo necesita el DSN como secret; **no hay que configurar nada en el dashboard
de Cloudflare**.

```bash
# Producción (interactivo o por stdin)
node node_modules/wrangler/bin/wrangler.js secret put SENTRY_DSN

# Opcional: entorno (por defecto "production")
node node_modules/wrangler/bin/wrangler.js secret put SENTRY_ENVIRONMENT

# Desplegar para que el Worker lo lea
pnpm --filter @photos/api run deploy
```

En `wrangler dev` el DSN se toma de `apps/api/.dev.vars` (`SENTRY_DSN=...`).

Ahora mismo el Worker reutiliza el DSN del proyecto `photos` para no crear otro.
Es válido, pero mezcla eventos de cliente y servidor. Si más adelante quieres
separarlos: crea un proyecto **Cloudflare Workers** (`photos-api`), copia su DSN
y repite `secret put SENTRY_DSN`.

## Sobre el "run code" del onboarding

La página de bienvenida de Sentry genera un código de 10 caracteres
(`org-slug#run-code`) para que un agente reporte progreso a esa pantalla vía el
MCP de Sentry. Este CLI no tiene ese MCP conectado, así que ese progreso no se
puede marcar; la configuración del SDK no depende de él. El DSN es lo único que
hace falta para empezar a recibir eventos.

## Coste

El plan gratuito de Sentry cubre de sobra un proyecto personal (5k errores/mes).
`tracesSampleRate` está en `0.1` para no acercarse al límite de transacciones.
