# Rollback de despliegue

> Plan v2 · H1.4. Se ejecuta con el workflow [Rollback](../../.github/workflows/rollback.yml)
> (`workflow_dispatch`, entorno `production`, requiere escribir `ROLLBACK`).

## Antes de revertir

1. Abrir un incidente (SEV-2/3) y anotar commit desplegado: `curl https://photos-api.luis-sg9915.workers.dev/version`.
2. Confirmar que el problema es del deploy (no de datos): `node scripts/audit-prod.mjs`.

## API / web (sin migración de por medio)

1. `wrangler deployments list --name photos-api` para obtener `version_id` anteriores.
2. Actions → **Rollback** → `target = api-worker`, `version_id = <id>`, `confirm = ROLLBACK`.
3. El workflow corre `wrangler rollback`, luego `/version` y la portada web (smoke mínimo).

## Con migración aplicada

Wrangler no revierte migraciones de D1. Nunca se hace `db:migrate:remote` hacia atrás a mano:

1. **Preferido:** forward-fix (nueva migración que corrige el esquema) con la app cerrada.
2. Si el esquema quedó inconsistente: `target = d1-restore-to-new-db` con el `backup_key` más reciente
   (`d1/...` en el bucket `photos-backups`), validar `PRAGMA integrity_check` y conteos, cambiar
   `database_id` en
   `apps/api/wrangler.jsonc` y desplegar.
3. RPO aceptado: hasta 24 h (backup diario). Ver `docs/ops/SLO.md`.

## Criterio de cierre

- `/version` devuelve la versión anterior.
- Smoke de producción verde (con secretos del repo).
- `audit-prod.mjs` sin drift ni huérfanos nuevos.
- Postmortem breve enlazado desde `PLAN_MEJORAS.md`.
