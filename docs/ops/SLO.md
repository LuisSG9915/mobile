# SLOs y alertas (Plan v2 · H2.1)

> Borrador operativo adoptado en H1.7. Los valores se revisan al cerrar cada horizonte.

## Servicios e indicadores

| Servicio | SLI | SLO | Fuente |
| :--- | :--- | :--- | :--- |
| Respaldo | % de assets seleccionados con `state=done/duplicate` en 24 h | ≥ 99 % | cola (SQLite/IndexedDB) + `/v1/stats` |
| API | % de respuestas < 500 en `/v1/*` y `/api/auth/*` | 5xx < 0.5 % | wrangler tail / Sentry |
| Cron | ejecuciones de `runCleanup` con éxito por día | 100 % (1/día) | `system_state.cron_last_run` (H1.7) |
| Recuperación | RTO/RPO del restore drill | RTO < 4 h, RPO < 24 h | informe de drill |

## Alertas mínimas

1. **Cron caído:** `now - cron_last_run > 26 h` → email.
2. **Backup fallido:** el workflow `backup-d1` termina con error o no corre 26 h → email de GitHub.
3. **Backup R2 parcial:** `scripts/backup-r2.mjs` sale con `exit 1` si hay errores o el bucket
   devuelve 0 objetos, y el workflow `backup-r2-verify` lo ejecuta cada lunes con `--verify-sample 25`
   (H1.5). Un `Guard` con secrets ausentes también falla: no puede haber verde sin verificación.
4. **Drift de cuota:** `audit-prod.mjs` con `drift_bytes != 0` o huérfanos > 0 en 2 corridas seguidas.
5. **5xx:** Sentry o wrangler tail con umbral >0.5 % en 1 h.

## Estado actual (2026-10-23)

- Nunca se ha ejecutado un restore drill: **RTO/RPO no verificados**.
- No existe heartbeat real del cron (H1.7 pendiente).
- `audit-prod` no bloquea (H2.1 pendiente).
