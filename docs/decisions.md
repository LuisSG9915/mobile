# Decisiones de diseño — hardening de procesos (2026-10)

Contexto: auditoría con `scripts/audit-prod.mjs` encontró drift real de
`user_storage_stats` (224 B registrados vs 1.8 GB reales en el usuario
principal), cuota sin enforcement, cola nativa compartida entre cuentas,
sesiones expiradas acumuladas y subidas sin timeout ni cancelación.

Este documento fija los invariantes nuevos y las preguntas abiertas, para que
futuras sesiones no tengan que reconstruir el porqué.

## API

### Cuota (`/uploads/init`)

- Se chequea `used_bytes + fileSize + thumbSize > max_bytes` **antes** de
  presignar → `413 quota_exceeded`.
- `used_bytes` cuenta solo media `ready` **incluyendo papelera** (sigue
  ocupando R2 hasta la purga). Los `pending` NO cuentan.
- **Limitación conocida:** el chequeo no es atómico bajo concurrencia — dos
  inits paralelos que caben individualmente pueden completar ambos y superar
  la cuota. Se aceptó la versión laxa (a esta escala el riesgo es bajo);
  endurecerla exigiría contar `pending` o una columna de reserva.
- `getUsageBytes` materializa la fila de `user_storage_stats` de forma
  perezosa (SUM sobre media) si no existe — sana usuarios pre-stats sin
  backfill.

### `/uploads/{id}/complete`

- Flip atómico: `UPDATE … SET status='ready' WHERE status='pending'`; la
  cuota solo se suma si `changes > 0`. Dos completes concurrentes cuentan
  una vez; la respuesta repetida sigue siendo 200 idempotente.
- Si `addStorageUsage` fallara tras el flip (raro), la reconciliación del
  cron lo corrige en la próxima corrida.

### Restore desde papelera

Re-init de un sha cuyo `ready` está soft-deleted → UPDATE `deleted_at=NULL`
y respuesta `duplicate`. No re-sube bytes ni re-cuenta cuota (los objetos
R2 ya existen bajo la misma clave sha256).

### Cron diario (`0 3 * * *`)

1. Purga `pending` inactivos por `updated_at` > 24 h (no `created_at`: un
   re-init activo refresca `updated_at` y no debe purgarse en pleno vuelo).
2. Purga papelera > 30 días: objetos R2 + fila + decremento de cuota solo
   para los que fueron `ready`.
3. Borra `session` y `verification` expiradas (better-auth no las limpia).
4. **Reconcilia `user_storage_stats`**: recalcula desde `media`
   (`status='ready'`, incluye papelera) con SET por usuario y pone a 0 las
   filas de usuarios sin media. Auto-corrige drift — el drift de prod se
   arregló solo en la primera corrida tras el deploy, sin backfill manual.
5. **Barrido de huérfanos R2**: lista `users/` (tope 5000 claves/corrida) y
   borra objetos sin fila en media con `uploaded` > 24 h. El margen protege
   PUTs en vuelo; el tope drena backlogs grandes en varias noches.
6. Lotes de 500 filas por pasada, hasta 10 rondas por corrida (límites del
   Worker); `BUCKET.delete` en trozos de 1000 claves.

### Rate limiting

- `AUTH_LIMITER` (binding `ratelimits`, 30 req/60 s por IP
  `cf-connecting-ip`, fallback `"anon"`) como middleware en `index.ts` solo
  para POST a `sign-in`, `sign-up`, `request-password-reset`, `reset-password`.
- NO usar `rateLimit` de better-auth: su storage en memoria vive por
  instancia y `createAuth` corre por request → nunca acumula. Código muerto.
- `UPLOAD_LIMITER` (120/60 s por usuario) sigue en `/uploads/init`.
- En dev/tests los bindings no existen → middleware no-op.

## Cola mobile

### Partición por usuario (SQLite nativo)

- PK compuesta `(user_id, asset_id)`: los ids de MediaLibrary son globales
  del dispositivo; dos cuentas chocarían sin el prefijo de usuario.
- Migración en caliente en `getQueueDb` (rename + rebuild + `INSERT OR
  IGNORE` con `user_id NULL`).
- `initializeQueue(userId)` fija `activeUserId`, adopta filas `NULL`
  (`UPDATE OR IGNORE`) y persiste `kv queue.owner`.
- **Adopción:** las filas legacy sin dueño las hereda el primer login —
  decisión válida en dispositivo monousuario; si el teléfono fue compartido
  antes de este cambio, los pendientes antiguos van al primero que entre.
- `closeQueue` suelta el contexto y **borra `queue.owner`** (cubre logout y
  sesión perdida: sin sesión, procesar quemaría reintentos contra 401).
  Las filas selladas quedan intactas e inertes para otras cuentas.
- Web: misma API sobre IndexedDB; el contexto `{userId, epoch}` ya existía.

### Background headless

La tarea `photos-backup-sync` corre sin sesión React: restaura
`queue.owner` (último usuario con sesión) antes de escanear/procesar.
Sin owner → no-op. Coste aceptado: una ventana transitoria sin sesión puede
hacer que el SO se salte una pasada programada.

### Scan

- Salta extensiones fuera de `ALLOWED_EXTENSIONS` (subirlas con el fallback
  las etiquetaría mal en R2).
- Una transacción por página (200 assets) vía `enqueueAssetsBatch`.
- `last_scan_ts:<userId>` por usuario: el primer scan de un usuario nuevo no
  queda suprimido por el throttle de otro.
- `runBackupPass({ forceScan })`: scan solo si pasaron 15 min o se fuerza;
  `processQueue` sigue corriendo cada 60 s. Botón manual y onboarding usan
  `forceScan: true`.

### Processor (paridad nativo/web)

- `cancelQueue` nativo ahora llama `activeUploadTask.cancelAsync()` (antes
  solo cortaba entre items).
- Watchdog de estancamiento: 90 s sin progreso → abortar y reintentar
  (XHR web y `createUploadTask` nativo).
- `apiFetch` tiene timeout de 30 s vía `Promise.race` (no
  `AbortSignal.timeout`: soporte irregular en Hermes); el `signal` del
  caller sigue pasando al fetch.
- Errores terminales sin quemar reintentos: 400 y 413 → `failed` directo;
  413 además `setBackupPaused(true)` (la alternativa marcaba `failed` toda
  la cola restante; el usuario libera espacio y reanuda).
- 401/403 → reencolar sin consumir intento y cortar la pasada (sesión
  caída; el próximo contexto válido reanuda).
- Errores transientes (red, 5xx, PUT fallido): `bumpAttempt` + backoff
  `BACKOFF_MS`, `failed` al llegar a `MAX_ATTEMPTS` (6 totales, ambos
  processors — ojo: leer `attempts` ANTES de `bumpAttempt`, la fila web es
  referencia viva).
- `recoverInterrupted()` al inicio de cada pasada (kill a mitad de item →
  transitorios vuelven a `queued` con `bytes_sent=0`).
- Al terminar un item se invalidan `timeline`, `stats` y `storage`.

### Recuperación de contraseña (email + deep link)

Flujo better-auth 1.7.7: `POST /api/auth/request-password-reset {email,
redirectTo}` crea `verification` `reset-password:{token}` (expira 1 h) y llama
`sendResetPassword`. El correo lleva `{API}/api/auth/reset-password/{token}?
callbackURL={redirectTo}`; ese GET valida y hace 302 a `callbackURL?token=…` o
`?error=INVALID_TOKEN`. El cliente cierra con `POST /api/auth/reset-password
{newPassword, token}`.

- **Anti-enumeración**: la request responde 200 siempre (incluso con timing
  simulado). La UI muestra confirmación genérica, nunca "correo no existe".
- **`redirectTo` por plataforma** (`mobile/src/auth/reset.ts`): web →
  `{origin}/reset-password`; nativo → `photos:///reset-password`. Ambos pasan
  `originCheck`: `photos://` (sin authority/path) matchea cualquier deep link
  del scheme y los orígenes http(s) se comparan por origin exacto.
- **Transporte**: `apps/api/src/email.ts` — con `RESEND_API_KEY` va por fetch a
  api.resend.com (sin dependencia npm); sin clave, el "envío" se loguea en
  wrangler para desarrollo (copiar el enlace del log). Fallos de envío no
  rompen la request (se loguean); el usuario puede re-pedir el enlace.
- **`revokeSessionsOnPasswordReset: true`**: tras resetear, todas las sesiones
  previas mueren — un dispositivo ajeno pierde acceso.
- Tokens expirados los purga el cron (`verification` ya se limpia).
- Secrets: `RESEND_API_KEY` vía `wrangler secret`; `EMAIL_FROM` como var cuando
  haya dominio verificado (sin dominio, Resend solo envía al email dueño de la
  cuenta).
- En dispositivo físico dev, el enlace del correo lleva `BETTER_AUTH_URL` — con
  localhost solo sirve si el correo se abre en el mismo PC.

## Pendiente operativo

- `AUTH_LIMITER` necesita `wrangler deploy` para existir en prod.
- Recuperación de cuenta en prod necesita `wrangler secret put RESEND_API_KEY`
  y un `EMAIL_FROM` con dominio verificado en Resend.
- `uso.txt` (raíz, gitignored) contiene credenciales en claro: rotar la
  contraseña y borrar el archivo.
- D1 local desactualizada: `pnpm --filter @photos/api db:migrate:local`.

## No hecho a propósito (alcance aprobado: urgentes + robustez)

- CI en `.github/workflows` (directorio vacío hoy).
- Dedup global entre usuarios: la auditoría midió ~50 MB de ahorro — no
  justifica rediseñar las claves `users/{id}/…`.
- Verificación de email al registro: la infraestructura de correo ya existe
  (`email.ts`), pero `requireEmailVerification` bloquearía el sign-in de los
  usuarios ya registrados en prod con `emailVerified=false`. Activarla exige
  primero marcar verificados los usuarios existentes o un período de gracia.
- `hasLocalCopy` queda `true` tras liberar la copia local (la fila `done`
  persiste).
- `ADMIN_EMAIL` duplicado entre `packages/shared/src/constants.ts` y
  `vars` de wrangler (pueden divergir).
