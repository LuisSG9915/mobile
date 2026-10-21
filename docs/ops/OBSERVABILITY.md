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

1. Crea un proyecto **React Native** en Sentry (org `cb-5d`) y copia el DSN.
2. Define el DSN en `apps/mobile/.env` para desarrollo y en el entorno de build
   (EAS) para los APK:

```ini
EXPO_PUBLIC_SENTRY_DSN=https://<key>@o<orgId>.ingest.sentry.io/<projectId>
EXPO_PUBLIC_SENTRY_ENVIRONMENT=production
```

3. **Recompila** el dev-client/APK: `@sentry/react-native` es un módulo nativo
   y el config plugin ya está en `app.json`. Un OTA no basta para la primera
   instalación.
4. Para stack traces legibles (source maps), añade en EAS los secrets
   `SENTRY_AUTH_TOKEN` y `SENTRY_PROJECT` (slug del proyecto). `SENTRY_ORG` ya
   está en `eas.json` como `cb-5d`. Sin ellos los reportes llegan igual, pero
   con nombres minificados.

Comprobación rápida: con el DSN puesto, ejecuta

```bash
pnpm check:sentry
```

Envía un evento de prueba al endpoint de ingesta (sin abrir la app) y te dice
el id. Búscalo en Sentry con el tag `source:check-sentry`. También puedes lanzar
un error desde el boundary o provocar un `throw` en desarrollo.

## Worker

```bash
# DSN del proyecto "Cloudflare Workers" de Sentry
node node_modules/wrangler/bin/wrangler.js secret put SENTRY_DSN

# Opcional: entorno (por defecto "production")
# En wrangler.jsonc → vars, o como secret:
node node_modules/wrangler/bin/wrangler.js secret put SENTRY_ENVIRONMENT
```

Despliega después de configurarlo. Sin el secret, `withSentry` recibe
`undefined` y el Worker se comporta exactamente igual que antes.

## Sobre el "run code" del onboarding

La página de bienvenida de Sentry genera un código de 10 caracteres
(`org-slug#run-code`) para que un agente reporte progreso a esa pantalla vía el
MCP de Sentry. Este CLI no tiene ese MCP conectado, así que ese progreso no se
puede marcar; la configuración del SDK no depende de él. El DSN es lo único que
hace falta para empezar a recibir eventos.

## Coste

El plan gratuito de Sentry cubre de sobra un proyecto personal (5k errores/mes).
`tracesSampleRate` está en `0.1` para no acercarse al límite de transacciones.
