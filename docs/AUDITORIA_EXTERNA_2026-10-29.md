# Revisión de la auditoría externa (2026-10-29)

> Auditoría recibida: «Viabilidad, Optimización y UX» sobre [PLAN_MEJORAS.md](PLAN_MEJORAS.md).
> Este archivo contrasta sus afirmaciones con el código en `5fa861b` (árbol limpio).
> Regla del plan aplicada: ninguna afirmación se acepta sin enlace a código o evidencia.

## 1. Veredicto

Útil como **checklist de ideas**, no como diagnóstico. Dos problemas la invalidan tal cual:

1. **Causa raíz equivocada** en su prioridad #1 (sincronización en segundo plano).
2. **Inventa trabajo ya hecho**: `sync-stats.ts` no existe en el repo. Es exactamente el fallo
   que la regla 2 del plan prohíbe («ningún `[x]` sin evidencia enlazada»).

Adoptarla sin filtrar lleva a arreglar lo que no está roto y a creer que hay progreso donde no lo hay.

## 2. Contraste punto por punto

| Afirmación de la auditoría | Estado | Evidencia |
| :--- | :---: | :--- |
| Multipart (>20 MB) usa `uploadAsync` sin `sessionType: BACKGROUND` | **Cierto a medias** | Cierto que multipart no pasa `sessionType`: [processor.ts:321](../apps/mobile/src/queue/processor.ts). Falso que eso rompa el background: `sessionType` es iOS-only y **ya vale `BACKGROUND` por defecto**; en Android se ignora («On Android, sessions always work in the background and you can't change it») — `expo-file-system/build/legacy/FileSystem.types.d.ts` |
| «Esto permite que vídeos grandes sigan subiendo con la app cerrada» | **Falso** | El task nativo sigue, pero el bucle JS que escribe la parte N+1 no: «the JavaScript `UploadTask` instance is not restored if the app is terminated or relaunched» — `expo-file-system/build/NetworkTasks.types.d.ts` |
| Falta velocidad (MB/s) y ETA | **Cierto** | Sin `eta`/`velocidad` en `apps/mobile/src` |
| «Se crearon helpers en `sync-stats.ts`» | **Falso** | El archivo no existe (`find`/`grep` sobre todo el repo) |
| Progreso multipart grueso (salta por parte) | **Cierto** | `publishByteTick` solo tras completar cada parte de 5 MiB: [processor.ts:344](../apps/mobile/src/queue/processor.ts), [constants.ts:40](../packages/shared/src/constants.ts) |
| Cola «topada en 2.000» | **Cierto, pero mal descrito** | Es el tope de la **proyección** a la galería, no del almacenamiento: [db.ts:376](../apps/mobile/src/queue/db.ts). El procesado pagina con `getPendingItems(limit=100)` |
| Subir TTL de presign a 3600 s para multipart | **Cierto y baratísimo** | Ya es variable de entorno con default 900: [s3.ts:62](../apps/api/src/lib/s3.ts) — `PRESIGN_TTL_SECONDS=3600` |
| Lifecycle rules para MPUs huérfanas | **Cierto, ya documentado** | [R2_LIFECYCLE.md](ops/R2_LIFECYCLE.md); falta confirmar que la regla está aplicada en los dos buckets |
| 10 GB de R2 son el cuello de botella | **Cierto, y peor de lo que dice** | La cuota por usuario es exactamente 10 GiB ([constants.ts:71](../packages/shared/src/constants.ts)) = 100 % del Free, y los backups D1 viven en el **mismo bucket** |
| Turnstile gratis para registro/reset | **Cargo cult** | Ya hay `AUTH_LIMITER` 30/min por IP: [wrangler.jsonc:62](../apps/api/wrangler.jsonc) |
| «Optimizar el Free Tier» como prioridad | **Prioridad invertida — y ya resuelta** | El muro del Free no era el almacenamiento: era **10 ms de CPU por invocación** (`Error 1102`, intermitente) y **100 000 escrituras D1/día**. La cuenta **está en Workers Paid desde el 2026-10-29**: quedan 30 s de CPU por defecto (`limits.cpu_ms` configurable) y D1 Paid (25 000 M filas leídas + 50 M escritas/mes). El debate deja de ser «¿pagar?» y pasa a «no pasarse de 30 s por invocación». R2 sigue a $0,015/GB-mes |
| Premisa de que los 10 GB de R2 son un depósito que se llena y se vacía gratis | **Mal entendido de facturación** | El GB-mes es el **promedio del pico diario** sobre 30 días: llenar 100 GB tres días ya consume `100×3/30 = 10 GB-mes`; vaciar a mitad de mes no devenga lo gastado |
| Logpush a R2 en Free Tier | **Incompatible con Free; viable con el plan actual** | Workers Logpush no existe en Free. Con Workers Paid (activo desde el 2026-10-29) sí es una opción, y `SENTRY_DSN` ya cubre el caso básico sin añadir nada |
| Réplicas de lectura D1 / sprites de thumbs / cache-proxy edge | **Sin justificar** | A un usuario, cero impacto medible; los thumbs ya son WebP ≤50 KB con clave inmutable por sha256 |
| Notificaciones locales progresivas | **Subestima el coste** | `expo-notifications` no está instalado: exige dependencia nativa y **rebuild del dev-client** (regla del repo). Y una notificación de progreso no se puede actualizar desde un task en background sin foreground service |

## 3. Lo que la auditoría no vio (y es más grave)

1. **Base64 en el camino multipart.** Cada parte de 5 MiB se lee como string base64 y se reescribe a
   caché antes de subir: [processor.ts:310-317](../apps/mobile/src/queue/processor.ts). Un vídeo de
   1 GB son ~205 partes → ~1,4 GB de churn de strings en JS. Este es el coste real de subir vídeo,
   no el `sessionType`.
2. **La ruta buena ya existe en el mismo archivo**: `createUploadTask` con progreso, watchdog de
   estancamiento y registro en `activeUploadTasks` para poder cancelar ([processor.ts:130-152](../apps/mobile/src/queue/processor.ts)).
   Multipart no la usa. Unificar las dos rutas arregla progreso, cancelación y ETA de una vez.
3. **La cuota de 10 GiB no tiene holgura**: usuario lleno + thumbs + previews + backups D1 en el
   mismo bucket > 10 GB gratis. Reducir cuota o mover backups de bucket es decisión de coste, no de UX.

## 4. Qué se queda

Ya no vive aquí: está convertido en trabajo con criterio de cierre en el tablero vigente
([PLAN_MEJORAS.md](PLAN_MEJORAS.md) §3.1–3.2):

- **H1.8 / U1–U4** — quitar base64 del camino multipart, partes de 16 MiB con 3 en vuelo, prefirmado
  por lotes y velocidad/ETA en la proyección existente (`computeSyncProgress`,
  [progress.ts:26](../apps/mobile/src/queue/progress.ts)), sin archivo nuevo ni estado duplicado.
- **H1.9** — decir la verdad sobre el segundo plano y retirar el permiso huérfano
  `FOREGROUND_SERVICE_DATA_SYNC`.
- Corregir la ventana de presign (variable de entorno, 5 minutos de trabajo).
- Confirmar lifecycle rules aplicadas en `photos-media` y `photos-media-dev`.

## 5. Qué se descarta

Sprites, réplicas D1, Logpush, Turnstile, notificaciones locales y las 10 acciones de UX como bloque:
onboarding, estados vacíos y accesibilidad **ya son H3.1/H3.2** del plan vigente. Añadirlas ahora
viola la regla 4 («un P0 abierto bloquea cualquier feature nueva») y duplica el tablero.

## 6. Nota de proceso

El informe diagnostica «sobrecarga cognitiva» y a continuación entrega ~40 tareas nuevas sobre un plan
que ya tiene H1/H2/H3 con calendario semanal. El riesgo de burnout no se resuelve añadiendo un cuarto
tablero: se resuelve no abriéndolo.
