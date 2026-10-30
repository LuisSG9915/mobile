# Respaldo y restauración de D1

R2 guarda los binarios (originales y miniaturas), pero **D1 guarda el catálogo**:
usuarios, sesiones, álbumes, favoritos, shares, metadatos, claves R2 y cuotas.
Si D1 se pierde, las fotos siguen existiendo en R2 pero la app no puede mostrarlas.

## Qué se respalda y cuándo

| | |
|---|---|
| Workflow | `.github/workflows/backup-d1.yml` |
| Frecuencia | Diario, 03:30 UTC (después del cron de limpieza de las 03:00) |
| Destino | `r2://photos-backups/d1/d1-<timestamp>.sql` — bucket **distinto** del de producción (`photos-media`) |
| Integridad | `.sha256` junto a cada export |
| Validación | Dry-run en SQLite efímero (`sqlite3 :memory: < backup.sql`), `PRAGMA integrity_check;` y conteo de tablas; falla si está vacío o no contiene `CREATE TABLE` |
| Retención | 90 días vía lifecycle rule (ver abajo) |

El respaldo incluye esquema y datos (`wrangler d1 export` por defecto). No incluye
objetos de R2: esos los cubre `scripts/backup-r2.mjs` / `rclone` según
[`docs/backup-321.md`](../backup-321.md).

## Crear el bucket de respaldos (una sola vez)

Desde H1.5 el respaldo vive fuera del bucket de producción: si las fotos y el catálogo comparten
destino, un borrado, un token filtrado o un lifecycle mal escrito se lleva las dos copias a la vez.

```bash
node node_modules/wrangler/bin/wrangler.js r2 bucket create photos-backups
node node_modules/wrangler/bin/wrangler.js r2 bucket lifecycle add photos-backups \
  d1-backups d1/ --expire-days 90 --force
```

El workflow aborta si `BACKUP_BUCKET` coincide con `photos-media` (paso *Guard*), así que la
separación no se puede perder por descuido. Para usar otro nombre, define la variable de repo
`BACKUP_BUCKET`.

## Secrets requeridos

En **Settings → Secrets and variables → Actions** del repositorio:

| Secret | Valor | Permisos del token |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Token de API de Cloudflare | `D1:Edit` y `Workers R2 Storage:Edit` |
| `CLOUDFLARE_ACCOUNT_ID` | `461d52ab67ae2435c8dde9a0887f27cb` | — |

Sin `CLOUDFLARE_API_TOKEN` el workflow falla en el export (no sube nada).
El token es de cuenta, no la OAuth local de `wrangler login`.

## Ejecución manual

- Desde GitHub: **Actions → Backup D1 → Run workflow**.
- En local (usa tu OAuth de `wrangler login`, sin token de CI):

```bash
mkdir -p backups
node node_modules/wrangler/bin/wrangler.js d1 export photos-db \
  --remote --skip-confirmation --output backups/d1-manual.sql
sha256sum backups/d1-manual.sql   # Windows: certutil -hashfile backups\d1-manual.sql SHA256
```

## Retención (una sola vez)

R2 lifecycle para que los respaldos viejos no crezcan sin límite:

```bash
node node_modules/wrangler/bin/wrangler.js r2 bucket lifecycle add photos-backups \
  d1-backups d1/ --expire-days 90 --force
```

Verificar:

```bash
node node_modules/wrangler/bin/wrangler.js r2 bucket lifecycle list photos-backups
```

## Restauración

> Restaurar sobre la base en producción sobrescribe datos. Hazlo con la app
> cerrada y, si es posible, sobre una base nueva y cambia el `database_id`.

### 1. Descargar el respaldo

```bash
node node_modules/wrangler/bin/wrangler.js r2 object get \
  photos-backups/d1/d1-2026-10-20T03-30-00Z.sql \
  --file backups/d1-restore.sql --remote

node node_modules/wrangler/bin/wrangler.js r2 object get \
  photos-backups/d1/d1-2026-10-20T03-30-00Z.sql.sha256 \
  --file backups/d1-restore.sql.sha256 --remote
```

Verificar el checksum (`sha256sum -c` en Linux/macOS; `certutil` en Windows).

### 2. Restaurar en una base nueva (recomendado)

```bash
# Crear base de restauración
node node_modules/wrangler/bin/wrangler.js d1 create photos-db-restore

# Importar el SQL (incluye esquema y datos)
node node_modules/wrangler/bin/wrangler.js d1 execute photos-db-restore \
  --remote --file backups/d1-restore.sql --yes

# Validar antes de cambiar producción
node node_modules/wrangler/bin/wrangler.js d1 execute photos-db-restore \
  --remote --command "SELECT count(*) AS users FROM user; SELECT count(*) AS media FROM media;"
```

Si los números cuadran, actualiza `database_id` en `apps/api/wrangler.jsonc`
al id de `photos-db-restore`, despliega y ejecuta el smoke test:

```bash
node scripts/audit-prod.mjs
pnpm --filter @photos/api run deploy
```

### 3. Restaurar sobre la base existente (emergencia)

Solo si no puedes crear una base nueva. El export trae `CREATE TABLE`, así que
en una base con tablas fallará; para ese caso genera un export **sin esquema**:

```bash
node node_modules/wrangler/bin/wrangler.js d1 export photos-db \
  --remote --no-schema --output backups/d1-data-only.sql
```

Y luego, con la app cerrada:

```bash
node node_modules/wrangler/bin/wrangler.js d1 execute photos-db \
  --remote --file backups/d1-data-only.sql --yes
```

### 4. Comprobaciones posteriores

- `SELECT count(*) FROM media WHERE status = 'ready';` coincide con lo esperado.
- `node scripts/audit-prod.mjs` sin huérfanos nuevos.
- Abrir la app, cargar timeline y subir una foto de prueba.

## Notas

- `wrangler d1 export` puede tardar; el workflow tiene timeout por defecto de
  GitHub (6 h), de sobra.
- El export diario se hace con la app en uso; D1 es transaccional y el export
  obtiene una vista consistente.
- Si el workflow falla repetidamente, GitHub notifica al propietario del repo
  por correo (comportamiento por defecto de los workflows programados).
