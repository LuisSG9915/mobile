# Simulacro de Restauración (Restore Drill)

> Plan v2 · H1.5. Guía de ejecución para validar la recuperabilidad del catálogo D1 y objetos R2 ante desastre o corrupción.
> **Fecha de formulación:** 2026-10-24
> **Objetivo:** Demostrar que el respaldo diario en R2 puede restaurarse de forma íntegra en una base aislada sin afectar producción.

---

## 1. Parámetros de Recuperación (SLO)

| Métrica | Objetivo | Justificación |
| :--- | :---: | :--- |
| **RPO de catálogo (D1)** | **24 horas** | El backup diario corre a las 03:30 UTC en `.github/workflows/backup-d1.yml`, a un bucket separado (`photos-backups`). En el peor de los casos la pérdida máxima de metadatos es de 24 h. |
| **RPO de binarios (R2)** | **7 días** | Los originales son la fuente de verdad y la app los re-sube desde los dispositivos; la copia offsite 3-2-1 se actualiza semanalmente/manualmente ([backup-321.md](../backup-321.md)). Un RPO de 0 solo existe para lo que ya está en un dispositivo. |
| **RTO (Recovery Time Objective)** | **4 horas** | Detección, descarga de artefactos desde R2, provisionamiento de `photos-db-restore`, rehidratación SQL y validación de integridad. Se mide con los relojes de los pasos 1 y 5 de este documento. |

---

## 2. Entorno Aislado

El simulacro se realiza **estrictamente sobre una base aislada** (`photos-db-restore`), sin tocar la base activa de producción `photos-db` ni el bucket de producción. El respaldo se lee de `photos-backups`, que desde H1.5 está separado del bucket de fotos: restaurar no requiere dar permiso de escritura sobre `photos-media`.

> [!WARNING]
> **REGLA DE SEGURIDAD:**
> Nunca ejecutar comandos `wrangler d1 execute --remote` sobre bases productivas sin autorización explícita y credenciales verificadas. No alterar el `database_id` de `apps/api/wrangler.jsonc` durante simulacros.

---

## 3. Procedimiento Paso a Paso

### Paso 1: Localizar y descargar el respaldo más reciente de R2

```bash
# Listar los respaldos disponibles en el bucket de respaldos
node node_modules/wrangler/bin/wrangler.js r2 object list photos-backups \
  --prefix d1/ --remote

# Descargar el volcado SQL y su checksum sha256 (sustituir <TIMESTAMP> por el deseado)
mkdir -p backups
node node_modules/wrangler/bin/wrangler.js r2 object get \
  photos-backups/d1/d1-<TIMESTAMP>.sql \
  --file backups/d1-restore.sql --remote

node node_modules/wrangler/bin/wrangler.js r2 object get \
  photos-backups/d1/d1-<TIMESTAMP>.sql.sha256 \
  --file backups/d1-restore.sql.sha256 --remote
```

### Paso 2: Verificar la integridad del archivo (Checksum)

```bash
# macOS / Linux:
sha256sum -c backups/d1-restore.sql.sha256

# Windows (PowerShell / Command Prompt):
# certutil -hashfile backups\d1-restore.sql SHA256
```

### Paso 3: Crear la base de datos D1 efímera/aislada

```bash
node node_modules/wrangler/bin/wrangler.js d1 create photos-db-restore
```
*Anotar el `database_id` devuelto por Cloudflare para la instancia de prueba.*

### Paso 4: Restaurar el esquema y los datos

```bash
node node_modules/wrangler/bin/wrangler.js d1 execute photos-db-restore \
  --remote --file backups/d1-restore.sql --yes
```

### Paso 5: Ejecutar consultas de validación de integridad

```bash
# Comprobación de integridad estructural SQLite
node node_modules/wrangler/bin/wrangler.js d1 execute photos-db-restore \
  --remote --command "PRAGMA integrity_check;"

# Verificación y conteo de tablas críticas
node node_modules/wrangler/bin/wrangler.js d1 execute photos-db-restore \
  --remote --command "
    SELECT 'user' AS tabla, count(*) AS filas FROM user
    UNION ALL SELECT 'session', count(*) FROM session
    UNION ALL SELECT 'media', count(*) FROM media
    UNION ALL SELECT 'album', count(*) FROM album
    UNION ALL SELECT 'album_media', count(*) FROM album_media
    UNION ALL SELECT 'storage_quota', count(*) FROM storage_quota
    UNION ALL SELECT 'system_state', count(*) FROM system_state;
  "
```

### Paso 6: Limpieza posterior del simulacro

Una vez comprobada la integridad y los conteos, eliminar la base de datos temporal:

```bash
node node_modules/wrangler/bin/wrangler.js d1 delete photos-db-restore --skip-confirmation
rm -f backups/d1-restore.sql backups/d1-restore.sql.sha256
```

---

## 4. Resultado de Ejecución (Drill Log)

> Esta sección debe ser completada y firmada por el operador humano tras ejecutar el simulacro con credenciales reales.

- **Fecha de ejecución:** `[PENDIENTE: YYYY-MM-DD]`
- **Operador responsable:** `[PENDIENTE: Nombre / Rol]`
- **Archivo de respaldo probado:** `r2://photos-backups/d1/d1-[TIMESTAMP].sql`
- **Hash SHA-256 verificado:** `[PENDIENTE: OK / MISMATCH]`
- **ID de base aislada utilizada:** `[PENDIENTE: UUID]`
- **Tiempo total de restauración:** `[PENDIENTE: MM minutos]` (Objetivo RTO: < 240 min)
- **Resultado `PRAGMA integrity_check`:** `[PENDIENTE: ok]`
- **Conteo de tablas críticas:**
  - `user`: `[PENDIENTE]`
  - `session`: `[PENDIENTE]`
  - `media`: `[PENDIENTE]`
  - `album`: `[PENDIENTE]`
  - `album_media`: `[PENDIENTE]`
  - `storage_quota`: `[PENDIENTE]`
  - `system_state`: `[PENDIENTE]`
- **Veredicto final:** `[PENDIENTE: EXITOSO / FALLIDO]`
- **Incidencias o desviaciones observadas:**
  `[Ninguna / Describir cualquier anomalía]`
