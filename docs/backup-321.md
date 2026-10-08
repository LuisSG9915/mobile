# Estrategia de Respaldo Físico 3-2-1 ($0 Egress con Cloudflare R2)

Esta guía explica cómo implementar una estrategia de respaldo **3-2-1** completa y profesional para tu fototeca, aprovechando que **Cloudflare R2 tiene $0 costo de transferencia saliente (Zero Egress Fees)**.

---

## 1. ¿Qué es la Estrategia 3-2-1?

La regla 3-2-1 es el estándar de la industria para evitar pérdida de datos:

- **3 Copias de tus datos:**
  1. *Copia 1 (Dispositivo):* Tu teléfono móvil o navegador.
  2. *Copia 2 (Nube - Primaria):* Bucket Cloudflare R2 (`photos-media`).
  3. *Copia 3 (Física local - Secundaria):* Tu ordenador personal, disco duro externo o NAS.
- **2 Medios de almacenamiento diferentes:**
  - Almacenamiento de objetos en la nube (R2) + Disco magnético / SSD local (NTFS/ext4/APFS).
- **1 Copia fuera del sitio (Offsite):**
  - Cloudflare R2 está distribuido geográficamente en centros de datos con 99.999999999% (11 nueves) de durabilidad anual, protegido contra robos, incendios o desastres físicos en tu hogar.

---

## 2. La Gran Ventaja de Cloudflare R2: $0 Egress

A diferencia de Amazon S3, Google Cloud Storage o Backblaze B2 (donde descargar gigabytes o terabytes de fotos cuesta entre $0.01 y $0.09 por GB), **Cloudflare R2 no cobra tarifas de egress**.

Esto significa que puedes:
- Sincronizar toda tu biblioteca a tu disco local todas las noches.
- Descargar tus 15 GB, 100 GB o 1 TB completos tantas veces como quieras.
- **Costo total de ancho de banda: $0.00**.

---

## 3. Opción A: Script Automatizado en Node.js (Incluido en el Proyecto)

El repositorio incluye un script listo para usar en `scripts/backup-r2.mjs`.

### Requisitos previos

Tener configuradas las credenciales de R2 en tus variables de entorno o en `apps/api/.dev.vars`:
```ini
R2_ACCOUNT_ID=tu_account_id_de_cloudflare
R2_ACCESS_KEY_ID=tu_r2_access_key
R2_SECRET_ACCESS_KEY=tu_r2_secret_key
R2_BUCKET_NAME=photos-media
```

### Ejecución directa

```bash
# Ejecutar con el comando configurado en pnpm
pnpm backup:r2

# O especificar una ruta de destino personalizada
node scripts/backup-r2.mjs --out "D:/Respaldos/Fotos_R2"
```

### Características del script:
- **Descarga incremental:** Si el archivo ya existe en tu disco local y coincide en tamaño de bytes, lo omite instantáneamente.
- **Estructura idéntica:** Conserva las rutas de usuarios y originales (`users/{userId}/originals/{sha256}.{ext}`).
- **Zero Egress:** No genera costes adicionales.

---

## 4. Opción B: Sincronización con Rclone (Recomendado para NAS o Discos Externos)

[Rclone](https://rclone.org/) es una herramienta de línea de comandos en Go altamente eficiente para sincronizar nubes y discos locales.

### Paso 1: Instalar Rclone
- **Windows:** `winget install Rclone.Rclone` o `choco install rclone`.
- **macOS:** `brew install rclone`.
- **Linux:** `sudo apt install rclone` o `curl https://rclone.org/install.sh | sudo bash`.

### Paso 2: Configurar R2 en Rclone
Ejecuta:
```bash
rclone config
```

1. Selecciona `n` (New remote).
2. Nombre: `r2`.
3. Tipo de almacenamiento: `s3` (Amazon S3 Compliant Storage Providers).
4. Proveedor: `Cloudflare` (Cloudflare R2 Storage).
5. `env_auth`: `false`.
6. `access_key_id`: Tu R2 Access Key ID.
7. `secret_access_key`: Tu R2 Secret Access Key.
8. `endpoint`: `https://<TU_ACCOUNT_ID>.r2.cloudflarestorage.com`.
9. Deja el resto de opciones en blanco (enter).

### Paso 3: Sincronizar a tu disco local

Para hacer un espejo exacto de tus fotos a un disco local o unidad externa:

```bash
# Windows
rclone sync r2:photos-media D:\Backups\Fotos-R2 --fast-list --transfers 8 --progress

# Linux / macOS
rclone sync r2:photos-media /mnt/nas/backups/photos-r2 --fast-list --transfers 8 --progress
```

> **Parámetros recomendados:**
> - `--transfers 8`: Descarga hasta 8 fotos en paralelo para saturar tu conexión y terminar en segundos.
> - `--fast-list`: Reduce las llamadas API de listado (menos transacciones Clase B).
> - `--dry-run`: Te permite simular qué archivos se descargarían sin escribir nada en disco.

---

## 5. Automatización Periódica

### En Windows (Programador de Tareas)
1. Abre el **Programador de tareas** (`taskschd.msc`).
2. Crear tarea básica -> Nombre: `Respaldo Diario R2 Fotos`.
3. Desencadenador: Diariamente a las `03:00 AM`.
4. Acción: Iniciar un programa.
   - Programa: `node.exe` (o `rclone.exe`).
   - Argumentos: `C:\desarrollo\test_project\scripts\backup-r2.mjs --out "D:\Backups\Fotos_R2"`
5. Guardar.

### En Linux / macOS / Synology NAS (Cron)
Edita tus tareas cron con `crontab -e`:
```bash
# Ejecutar todas las noches a las 4:00 AM
0 4 * * * node /ruta/al/proyecto/scripts/backup-r2.mjs --out /mnt/disco_externo/fotos >> /var/log/backup-r2.log 2>&1
```

---

## Resumen

Con esta configuración:
1. Tus fotos se respaldan de tu teléfono al Worker y a Cloudflare R2 sin tocar servidores intermedios.
2. Cada noche, tu ordenador o disco local descarga los nuevos originales.
3. Si pierdes tu móvil, restauras desde R2.
4. Si Cloudflare tuviera alguna caída o cerraras tu cuenta, tienes una copia física exacta en tu casa.
5. **Costo de almacenamiento mensual: $0.00** (dentro de los 10 GB de R2, o centavos si creces a 50+ GB).
6. **Costo de descarga: $0.00 de por vida.**
