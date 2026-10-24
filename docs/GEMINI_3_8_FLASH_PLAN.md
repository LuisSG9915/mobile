# Guion de ejecución para Gemini 3.8 Flash

> **Cómo usarlo:** copia el bloque **PROMPT** completo en Gemini 3.8 Flash con el repositorio abierto
> (no un ZIP binario). Las secciones siguientes son el detalle que el agente debe consultar cuando el
> prompt lo indique. El runner local es `scripts/gemini-gate.mjs`.

---

## PROMPT

```text
Eres un agente de ingeniería en el monorepo "Photos Platform" (Expo + Cloudflare Workers/D1/R2).
Trabajas en el checkout actual, no en un ZIP. Tu objetivo es ejecutar el Plan v2 hasta donde el
entorno lo permita, con evidencia real y sin inventar resultados.

CONTEXTO OBLIGATORIO (léelo antes de tocar nada):
- Plan vigente: docs/PLAN_MEJORAS.md (Plan v2; H1 en curso). No existe un PLAN_V2.md aparte.
- Reglas del repo: AGENTS.md y apps/mobile/AGENTS.md.
- Estado actual: H1.2 done (cuota + I-08), H1.1/H1.4/H1.5/H1.6/H1.7 in_progress.
- Baseline: 144 tests API, 232 mobile, 31 pipeline; lint/typecheck verdes.
- HEAD `ea855dd` (2026-10-24) ya contiene el grueso de H1.2/seguridad/release. Quedan ~16 archivos
  sin commitear (I-07/I-08, correcciones del tablero, este guion y el runner). NO asumas que HEAD los
  contiene; revisa `git status` antes de stagear.
- Pendientes: E2E multipart con R2 dev, commit por bloques, tag/APK, restore drill, callbackURL de
  verificación, headers/secretos en producción y prueba de alerta del cron.

REGLAS DURAS:
1. No ejecutes `git push`, `git tag`, `wrangler deploy`, `wrangler d1 execute --remote`, `eas build`
   ni ningún borrado remoto sin aprobación explícita del humano.
2. No toques producción ni R2 real. El único E2E con R2 es el de dev (`photos-media-dev`) y solo si
   existe `apps/api/.dev.vars`.
3. No marques `[x]` en docs/PLAN_MEJORAS.md sin enlace a test/commit/artefacto. Si algo queda
   bloqueado, escribe el bloqueo con el comando y el error exactos.
4. No inventes credenciales, secretos ni resultados. Si faltan, pasa a la fase siguiente y registra
   "bloqueado por entorno".
5. No hagas `pnpm install` si hay un `expo start` corriendo (AGENTS.md). No compiles builds nativos.
6. No edites migraciones a mano ni snapshots: usa `pnpm --filter @photos/api db:generate` y verifica
   que no queden cambios pendientes.
7. Usa Biome (`pnpm lint:fix`), español para la UI, y no toques archivos ajenos al plan.
8. Si un test falla por una causa no relacionada con tu cambio, párate y repórtalo; no lo "arregles"
   desactivándolo.

FASE 0 — Reconocimiento (5 min)
- Ejecuta: git status --short; git log -1 --oneline; pnpm -v; node -v.
- Comprueba: test -f apps/api/.dev.vars && echo DEV_VARS_OK || echo DEV_VARS_MISSING.
- Comprueba que no haya un expo start zombie: (lsof -nP -iTCP:8081 -sTCP:LISTEN) o `Get-NetTCPConnection`.
- Lee docs/PLAN_MEJORAS.md (H1), CHANGELOG.md y docs/ops/ROLLBACK.md.
- Devuelve un plan corto de 6 líneas: qué harás, qué puede quedar bloqueado y qué no tocarás.

FASE 1 — Línea base
- Ejecuta: node scripts/gemini-gate.mjs --quick
- Si falla lint/typecheck/pipeline, PARA y reporta. No sigas sobre una base rota.

FASE 2 — H1.6: callbackURL de verificación de email (sin secretos)
- Inspecciona apps/api/src/auth.ts, apps/api/src/email.ts, apps/mobile/src/auth/client.ts,
  apps/mobile/src/auth/client.web.ts y la versión de better-auth en package.json.
- Implementa que el enlace de verificación vuelva a:
  - web: `${origin}/welcome` (o la ruta real de bienvenida);
  - nativo: deep link `photos:///welcome` (usa expo-linking; no hardcodees el host).
- Pasa ese `callbackURL` en signUp.email y en resendVerificationEmail; no dupliques lógica.
- Añade un test unitario para la función de redirect (web/nativo) y, si el harness lo permite, uno
  del email con callbackURL. No imprimas tokens ni emails completos.
- Ejecuta los tests de mobile y API. No marques H1.6 done: aún faltan Resend real y headers en prod.

FASE 3 — H1.1: E2E multipart con R2 dev (condicional)
- Si DEV_VARS_MISSING: registra bloqueo y salta a Fase 4. No simules el E2E.
- Si está: ejecuta
  pnpm --filter @photos/mobile exec playwright test e2e/multipart-resume.spec.ts
- Si falla, depura SOLO lo relacionado (ruta /uploads/multipart/finalize, uploadId/resumed, partes).
  No cambies el test para que pase sin arreglar el código.
- Evidencia: salida del test + estado de la fila (done) + `stats.count=1`.

FASE 4 — H1.4: preflight de release (sin tag)
- Preflight (puede haber cambios sin commitear): pnpm release:check --tag v1.1.0 --allow-dirty
- Tras la Fase 7 (commits), repite sin `--allow-dirty`: pnpm release:check --tag v1.1.0
- Si falla por changelog, corrígelo. Si falla por árbol sucio, haz la Fase 7 (commits) y repite sin
  `--allow-dirty`.
- NO crees el tag, NO hagas push, NO lances EAS. Deja el comando listo y pide aprobación.

FASE 5 — H1.5: restore drill (solo documentación si no hay credenciales)
- Crea docs/ops/RESTORE_DRILL.md con: fecha, RPO/RTO (24 h/4 h), pasos de D1_BACKUP.md, validación
  PRAGMA integrity_check, conteos, y un apartado "resultado" vacío.
- Si y solo si el humano autoriza y hay credenciales: restaura a `photos-db-restore` (nunca sobre
  producción), mide tiempos y rellena el informe.
- No ejecutes `d1 execute --remote` sin autorización.

FASE 6 — H1.7: alerta del cron (validación estática)
- Revisa .github/workflows/cron-heartbeat.yml y docs/ops/SLO.md.
- Comprueba que el workflow falla si `cron_last_run` tiene >26 h o `ok=false`.
- Si `gh auth status` y los secrets están disponibles y el humano lo autoriza, lanza
  `gh workflow run cron-heartbeat.yml` y observa el resultado. Si no, registra "pendiente de secrets".
- No cambies el umbral ni el workflow para "hacerlo pasar".

FASE 7 — Evidencia y commits por bloques
- Revisa `git diff --stat` y `git diff` antes de stagear. No mezcles cambios ajenos al plan.
- En el estado de este guion, el P0/seguridad/release ya está en `ea855dd`. Los bloques restantes son:
  A) Integridad: apps/api/src/cron/cleanup.ts, apps/api/src/lib/storage-stats.ts, apps/api/src/lib/s3.ts,
     apps/api/src/routes/media.ts, apps/api/test/media.test.ts.
  B) Plan/docs: docs/PLAN_MEJORAS.md, docs/README.md, docs/REVISION_COBERTURA_PLAN.md,
     docs/testing/PLAN_IMPLEMENTACION_DEVIN.md, docs/ops/R2_LIFECYCLE.md, CHANGELOG.md, README.md, ROADMAP.md.
  C) Herramientas: scripts/release-check.mjs, scripts/gemini-gate.mjs, docs/GEMINI_3_8_FLASH_PLAN.md.
  Si el árbol cambió desde entonces, adapta los bloques a `git status`.
- Commits: `git add <rutas>` y `git commit -m "..."` (no `git add -A` si hay archivos ajenos).
- Después de cada bloque: `node scripts/gemini-gate.mjs --quick`.
- Si un archivo mezcla hunks ajenos, usa `git add -p` o déjalo fuera y repórtalo.

FASE 8 — Cierre
- Ejecuta `node scripts/gemini-gate.mjs` completo (sin --quick) y, si hay R2 dev, con --e2e.
- Actualiza docs/PLAN_MEJORAS.md con evidencia: enlaces a tests, commits y bloqueos. Sin `[x]` falsos.
- Actualiza CHANGELOG.md solo con cambios reales.
- Entrega un informe con: fases OK/BLOQUEADAS, archivos, comandos, evidencias, riesgos y siguiente
  acción humana (tag, APK, secrets, restore drill).

CRITERIO DE PARADA:
- Un test falla y no es trivial de arreglar.
- Falta `.dev.vars`, secrets, credenciales o aprobación para una acción remota.
- Un cambio afecta a archivos ajenos al plan.
En esos casos: no improvises; escribe el bloqueo exacto en test-results/gemini-blockers.md y sigue
con la fase no bloqueada.

FORMATO DE RESPUESTA FINAL:
1. Tabla fase | estado | evidencia.
2. Archivos cambiados (agrupados por commit).
3. Comandos ejecutados y resultado.
4. Bloqueos con comando/error exactos.
5. Qué necesita el humano para cerrar H1.
```

---

## Detalle de las fases

### Fase 0 · Reconocimiento

| Comprobación | Comando |
| :--- | :--- |
| Estado del árbol | `git status --short` |
| HEAD | `git log -1 --oneline` |
| R2 dev | `test -f apps/api/.dev.vars` (PowerShell: `Test-Path`) |
| Puerto Expo | `lsof -nP -iTCP:8081 -sTCP:LISTEN` |
| Plan | `docs/PLAN_MEJORAS.md`, sección H1 |

**Salida esperada:** un plan de 6 líneas. No editar nada todavía.

### Fase 1 · Línea base

```bash
node scripts/gemini-gate.mjs --quick
```

Debe pasar lint, typecheck y 31 tests de pipeline. Si no, parar.

### Fase 2 · Verificación de email

Archivos de referencia:

- `apps/api/src/auth.ts` — `emailVerification.sendVerificationEmail`.
- `apps/api/src/email.ts` — plantilla y envío.
- `apps/mobile/src/auth/client.ts` / `client.web.ts` — `signUp`, `resendVerificationEmail`.
- `apps/mobile/src/app/(tabs)/backup.tsx` — banner y botón.

**Criterio de aceptación:** el enlace del correo incluye un `callbackURL` que aterriza en
`/welcome` (web) o `photos:///welcome` (nativo); un test unitario cubre la construcción del redirect.

### Fase 3 · E2E multipart

```bash
pnpm --filter @photos/mobile exec playwright test e2e/multipart-resume.spec.ts
```

Requiere `apps/api/.dev.vars` con R2 dev. El spec corta en `presign-parts`, recarga y exige
`resumed: true` + `1 de 1 respaldados`. Si no hay `.dev.vars`, **no** se ejecuta: se documenta.

### Fase 4 · Release

```bash
# Preflight (tolera árbol sucio; úsalo antes de commitear)
pnpm release:check --tag v1.1.0 --allow-dirty

# Tras los commits de la Fase 7
pnpm release:check --tag v1.1.0
```

No crear tag ni push. Si pasa, el humano decide:

```bash
git tag v1.1.0
git push origin v1.1.0
```

### Fase 5 · Restore drill

Guía: [`docs/ops/D1_BACKUP.md`](ops/D1_BACKUP.md) y [`docs/ops/ROLLBACK.md`](ops/ROLLBACK.md).
Crear `docs/ops/RESTORE_DRILL.md` con el informe; no restaurar producción.

### Fase 6 · Alerta del cron

Workflow: [`.github/workflows/cron-heartbeat.yml`](../.github/workflows/cron-heartbeat.yml). Requiere
`CLOUDFLARE_API_TOKEN` con D1:Read y `CLOUDFLARE_ACCOUNT_ID`. Sin secrets: validación estática.

### Fase 7 · Commits

Mensajes sugeridos:

```text
fix(api,mobile): multipart reanudable y cuota validada
feat(api,mobile): shares públicos acotados y verificación de email
ci(ops): heartbeat del cron, rollback y release check
docs(plan): evidencia de H1 y estado real
```

### Fase 8 · Cierre

```bash
node scripts/gemini-gate.mjs          # completo
node scripts/gemini-gate.mjs --e2e    # solo con R2 dev
```

El runner deja `test-results/gemini-gate-<timestamp>.md`. Adjunta ese archivo al informe.

---

## Mapa de archivos que el agente debe conocer

| Área | Archivos |
| :--- | :--- |
| Subidas | `apps/api/src/routes/uploads.ts`, `apps/api/src/lib/s3.ts`, `apps/mobile/src/queue/processor*.ts` |
| Cuota/papelera | `apps/api/src/lib/storage-stats.ts`, `apps/api/src/routes/media.ts`, `apps/api/src/cron/cleanup.ts` |
| Shares | `apps/api/src/routes/albums.ts`, `apps/api/src/routes/shared.ts`, `apps/mobile/src/app/shared/album/[token].tsx` |
| Auth | `apps/api/src/auth.ts`, `apps/mobile/src/auth/client*.ts`, `apps/mobile/src/app/(tabs)/backup.tsx` |
| Release | `scripts/release-check.mjs`, `.github/workflows/ci.yml`, `.github/workflows/rollback.yml` |
| Ops | `docs/ops/SLO.md`, `docs/ops/INCIDENT_RESPONSE.md`, `docs/ops/ROLLBACK.md`, `docs/ops/R2_LIFECYCLE.md` |

## Definition of Done de esta ejecución

- [ ] `node scripts/gemini-gate.mjs` verde (144 API + 232 mobile + 31 pipeline).
- [ ] H1.6 callbackURL implementado y testeado, o bloqueado por falta de entorno.
- [ ] H1.1 E2E ejecutado con R2 dev, o bloqueado explícitamente.
- [ ] `pnpm release:check --tag v1.1.0` pasa tras commits (sin tag).
- [ ] `docs/ops/RESTORE_DRILL.md` creado con placeholders/resultado.
- [ ] Plan actualizado con evidencia; sin `[x]` sin enlace.
- [ ] Informe final con fases, archivos, comandos y bloqueos.

## Anti-patrones prohibidos

- Marcar H1.1/H1.5/H1.6/H1.7 como done sin la prueba correspondiente.
- Cambiar el test de resume para que pase sin arreglar `uploadId`/`resumed`.
- Hacer `git add -A` con archivos ajenos al plan sin revisar.
- Ejecutar `wrangler deploy` o `git push` para "ver si funciona".
- Restaurar D1 sobre la base de producción.
- Pegar un ZIP binario al modelo y pedirle leer TypeScript.
