# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
[SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Planeado — Plan v2 H1 “Verdad y confianza”
- Cerrar P0 de multipart y cuota en dispositivo real (H1.1, H1.2).
- Release `v1.1.0` con APK y `/version` (H1.4), tras ejecutar el E2E de resume con R2 dev.
- Restore drill D1 + R2 con RTO/RPO (H1.5).
- Seguridad mínima: headers en producción, credenciales del smoke por secretos y `callbackURL` de la
  verificación hacia la app (H1.6).
- Heartbeat del cron y alertas (H1.7).

### Añadido
- Migraciones `0013_public_shriek.sql` (`media.upload_id`) y `0014_robust_patch.sql`
  (`album.share_allow_download`).
- Heartbeat del cron en `system_state.cron_last_run` y workflow `cron-heartbeat.yml` (>26 h o
  `ok=false` → falla y GitHub avisa).
- SLOs (`docs/ops/SLO.md`), runbooks (`docs/ops/INCIDENT_RESPONSE.md`), plantilla de issues y
  `docs/README.md`.
- Spec E2E `apps/mobile/e2e/multipart-resume.spec.ts` (21 MB, corte en presign-parts, recarga,
  `resumed: true`).
- Cabeceras de seguridad de la web (`apps/mobile/public/_headers`: CSP, HSTS, X-Frame-Options,
  Referrer-Policy, Permissions-Policy).
- Endpoint `POST /v1/uploads/multipart/finalize` (antes `.../complete`, oculto por la colisión
  con `/uploads/{id}/complete`): valida partes, tamaño y MIME y limpia objetos/reserva si falla.
- `uploadId` opcional en `/multipart/init`: reanuda la MPU existente (`resumed: true`).
- Tests de reanudación, re-init con tamaño distinto, `size_mismatch` y `mime_mismatch`.

### Cambiado
- El procesador nativo usa `multipartComplete`; el ETag de R2 es obligatorio.
- Re-init de una subida `pending` con otro tamaño → **409** (antes ampliaba la reserva).
- Docs: Plan v2 (`docs/PLAN_MEJORAS.md`), `ROADMAP` y `PLAN_GENERAL` quedan como histórico.

### Release y rollback (H1.4)
- `GET /version` devuelve `version`, `commit` y hora; el deploy inyecta `APP_VERSION`/`GIT_SHA`.
- `pnpm release:check --tag vX.Y.Z`: valida SemVer, árbol limpio, migraciones y changelog antes de etiquetar.
- Workflow **Rollback** (`workflow_dispatch`, entorno `production`) para `wrangler rollback` de API/web y
  restauración de D1 en una base nueva; guía en `docs/ops/ROLLBACK.md`.

### Seguridad (H1.6)
- **IDOR de portada cerrado:** `PATCH /albums/{id}` valida que `coverMediaId` sea una foto del usuario.
- **Enlaces públicos:** nueva ruta `GET /albums/public/{token}` con `SHARE_LIMITER` por IP, tope de 500
  elementos, `allowDownload` (por defecto **false**: el enlace solo devuelve miniaturas/previews) y
  URLs prefirmadas acotadas a la caducidad del enlace. La ruta heredada `/shared/album/{token}` responde 410.
- **Verificación de email:** el 403 `email_unverified` ya no se confunde con sesión caída; pausa el
  respaldo con motivo visible y ofrece reenviar el correo desde la pestaña Respaldo.
- **Smoke de producción sin credenciales en el repo:** usa los secretos `SMOKE_USER_EMAIL` /
  `SMOKE_USER_PASSWORD`; no registra cuentas en prod, limpia el media subido y devuelve exit 2 si no
  está configurado.

### Corregido
- Archivos > 20 MB ya no fallan en `object_missing` en web ni en nativo.
- `check-hashes`, álbumes, exportación y reconciliación consultan en trozos (<100 parámetros de D1).
- `/uploads/{id}/complete` rechaza filas multipart en vez de devolver 409 sin pista.
