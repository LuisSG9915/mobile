# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
[SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Pendiente para cierre total de H1
- Etiquetado de release `v1.1.0` en git y generación de APK EAS (`eas build --platform android --profile preview`).
- Ejecución remota del Restore Drill (`docs/ops/RESTORE_DRILL.md`) con credenciales y firma de tiempos.
- Verificación con dominio real en Resend (`RESEND_API_KEY`) y headers en producción.
- E2E multipart-resume con R2 dev cuando se configure `apps/api/.dev.vars`.

## [1.1.0] - 2026-10-24

### Añadido
- Helper `apps/mobile/src/auth/verification.ts` y soporte para `callbackURL` dinámico web (`${origin}/welcome`) y deep link nativo (`photos:///welcome` con `expo-linking`), integrado en `register.tsx`, `backup.tsx` y cubierto en tests de API y Mobile.
- Procedimiento formal de simulacro de recuperación en `docs/ops/RESTORE_DRILL.md` con RPO 24 h / RTO 4 h y consultas de validación en instancia aislada `photos-db-restore`.
- Runner de validación `scripts/gemini-gate.mjs` con modalidades rápida (`--quick`), completa y E2E (`--e2e`).
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
- `trash/empty` incluye previews, descuenta `previewSize` una vez y solo resta cuota si el lote se borró
  completo (evita doble descuento concurrente); las reservas `pending` se liberan.
- El cron agrega las actualizaciones de cuota por usuario (una query por usuario, no por fila) y pagina
  el aborto de MPUs huérfanas.
- Regla de ciclo de vida R2 documentada (`docs/ops/R2_LIFECYCLE.md`) para abortar MPUs a los 7 días.
- `/uploads/{id}/complete` rechaza filas multipart en vez de devolver 409 sin pista.
