# Respuesta a incidentes

> Plan v2 · H1.5/H1.7. Los runbooks se ensayan, no solo se escriben.

## Contacto y escalado

- **Dueño:** Luis (único on-call). Canal: email `luis.sg9915@gmail.com`.
- **Escalado:** Cloudflare (dashboard) y Sentry. Sin SLA 24/7: los SLOs son de mejor esfuerzo.
- **Alerta mínima:** cron caído >26 h, backup fallido, 5xx >0.5 % o drift de cuota.

## Clasificación

| Severidad | Definición | Ejemplo |
| :--- | :--- | :--- |
| **SEV-1** | Pérdida o riesgo de pérdida de fotos | D1 corrupta, R2 inaccesible, borrado masivo |
| **SEV-2** | Respaldo detenido o datos expuestos | Cron muerto, fallo de subida, IDOR/share |
| **SEV-3** | Degradación parcial | Latencia, error de UI, un usuario bloqueado |

## Runbooks

### R1 · D1 corrupta o perdida

1. Detener el deploy y el tráfico de escritura si es posible.
2. `wrangler d1 time-travel info photos-db` para verificar restauración a un punto previo.
3. Si Time Travel no cubre: restaurar desde `r2://photos-media/backups/d1/` a una base nueva
   ([D1_BACKUP.md](D1_BACKUP.md)).
4. Cambiar `database_id`, desplegar y ejecutar `node scripts/audit-prod.mjs`.
5. Registrar RTO/RPO reales y abrir postmortem.

### R2 · R2 inaccesible o bucket borrado

1. Confirmar con `wrangler r2 bucket list` y `scripts/audit-prod.mjs`.
2. Verificar que los originales existen en el respaldo físico (`scripts/backup-r2.mjs` / rclone).
3. Restaurar objetos con la estructura `users/{userId}/` y ejecutar la auditoría.
4. Si no hay copia offsite: **incidente SEV-1** y evaluar recuperación de fotografías desde los dispositivos.

### R3 · Token o secreto filtrado

1. Rotar `BETTER_AUTH_SECRET`, `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` y `CLOUDFLARE_API_TOKEN`.
2. Revocar sesiones (`/v1/user/sessions`) y forzar cambio de contraseña.
3. Revisar logs de acceso de R2/D1 en Cloudflare.

### R4 · Deploy malo

Detalle y comandos: [`ROLLBACK.md`](ROLLBACK.md).

1. Identificar el commit con `GET /version` y `wrangler deployments list`.
2. Lanzar el workflow **Rollback** (`api-worker`/`web-worker` + `version_id`).
3. Si hubo migración: no revertir a ciegas; forward-fix o restaurar el backup en una base nueva.
4. Ejecutar smoke y `audit-prod.mjs` antes de reabrir tráfico.

### R5 · Cron de limpieza caído

1. Comprobar `wrangler tail photos-api` y el trigger `0 3 * * *`.
2. Ejecutar manualmente `runCleanup` vía un endpoint/admin temporal o redeploy.
3. Verificar papelera y huérfanos con `audit-prod.mjs`.

### R6 · Cumplimiento de borrado (DSAR)

1. Verificar identidad del solicitante.
2. `DELETE /v1/user/account` con re-autenticación.
3. Confirmar 0 objetos bajo `users/{userId}/` y que el email no tenga sesiones.
4. Registrar la fecha y el método.

## Postmortem

Todo SEV-1/SEV-2 deja un documento corto: cronología, impacto, causa raíz, acciones y dueño con fecha.
Se enlaza desde `PLAN_MEJORAS.md` (tablero).

## Ejercicios

- **H1.5:** restore D1 + R2 a entorno nuevo, medida de RTO/RPO.
- **H1.7:** simular cron caído y comprobar que la alerta llega en <5 min.
