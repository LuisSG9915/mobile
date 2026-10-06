# Plan de pruebas — Photos

Cuatro capas, un solo comando. Todo se registra en `test-results/<runId>/` y se resume en `REPORT.md` + `summary.json`.

## Prerequisitos

1. `pnpm install` en la raíz.
2. `wrangler login` una vez (el binding R2 de `wrangler dev` es remoto y apunta a `photos-media-dev`).
3. `apps/api/.dev.vars` con las credenciales R2 (ver `.dev.vars.example`).
4. Playwright: `pnpm --filter @photos/mobile exec playwright install chromium` (solo la primera vez).
5. Migraciones locales: `test-all` las aplica solo; a mano: `pnpm --filter @photos/api db:migrate:local`.

## Capas

| Capa | Comando directo | Qué cubre |
|---|---|---|
| pipeline | `pnpm test:pipeline` | node:test sobre el propio runner/reporte (fixtures, sin wrangler/expo/R2) |
| lint | `pnpm lint` | Biome |
| typecheck | `pnpm typecheck` | tsc en todos los paquetes |
| api | `pnpm --filter @photos/api test` | vitest + Miniflare (100% local) |
| mobile | `pnpm --filter @photos/mobile test` | vitest + happy-dom, módulos `*.web.ts` |
| e2e | `pnpm --filter @photos/mobile test:e2e` | Playwright contra `wrangler dev` + `expo start --web` |
| native | manual | `docs/testing/native-checklist.template.json` |

Todo junto: `pnpm test:all` → `test-results/<runId>/{api,mobile,e2e,native,runs,summary}.json` + `REPORT.md` + `artifacts/e2e/` (screenshots y traces de Playwright quedan dentro de la corrida vía `E2E_OUTPUT_DIR`).

Código de salida de `test:all`: **1** si alguna capa ejecutada falla — incluye fallo de preparación (p. ej. migraciones), JSON de resultados ausente/corrupto o fallo del generador — y **0** solo si todo lo ejecutado pasó. Las capas omitidas con `--skip` quedan `not_run` y no alteran el exit code.

Estados por capa: `passed`, `failed`, `partial` (checklist nativo con casos verdes pero pendientes/bloqueados), `not_run` (omitida o no ejecutada). Una capa ejecutada sin JSON válido es `failed`, nunca `not_run`; un JSON residual de otra corrida no puede acreditar una capa omitida.

Opciones de `test-all`:

```bash
pnpm test:all                    # todas las capas
node scripts/test-all.mjs --skip e2e,native   # solo unitarias+lint+typecheck+pipeline
node scripts/test-report.mjs test-results/<runId>   # regenera el reporte (p. ej. tras llenar native.json)
```

Un `<runId>` completado no se reutiliza: el runner aborta si `test-results/<runId>/runs.json` ya existe. Usa `--run-id` distinto.

El E2E levanta solo `wrangler dev` (8787) y `expo start --web` (8081) si no están ya corriendo (`reuseExistingServer`). La API local usa el bucket R2 remoto `photos-media-dev`, así que `/complete` verifica objetos reales. **Guardarraíl**: `e2e/global-setup.ts` aborta la suite si `apps/api/.dev.vars` no apunta a `photos-media-dev` (y `cleanupUser` lo vuelve a comprobar antes de borrar). Los tests e2e borran únicamente el prefijo `users/<userId>/` de su usuario al terminar y fallan si R2 rechaza algún borrado.

Specs: `auth.spec.ts` (registro/login/logout y recarga con sesión), `upload.spec.ts` (subida, duplicado y extensión no permitida) y `queue-persistence.spec.ts` (cola en IndexedDB: reanudación tras recarga/cierre de pestaña, exclusión entre pestañas vía Web Locks y borrado local en logout).

## Checklist nativo

1. `test-all` copia `native-checklist.template.json` a `test-results/<runId>/native.json` si no existe.
2. Ejecutar cada caso en un dispositivo con el dev-client (`pnpm --filter @photos/mobile start`). Si no hay build instalado: `npx eas-cli@latest build --profile development`.
3. Marcar `status` por caso: `ok`, `falla` (con `notas`), `pendiente` o `bloqueado`.
4. Regenerar el reporte: `node scripts/test-report.mjs test-results/<runId>`.

En un dispositivo físico el API debe escuchar en la LAN: `pnpm --filter @photos/api dev -- --port 8787 --ip 0.0.0.0` (el cliente nativo resuelve el host por `expoConfig.hostUri`).

## Hallazgos

- Registro curado: `docs/testing/findings.json` (`status: abierto|en_progreso|resuelto`, severidad, propuesta, esfuerzo, `relatedTests`).
- El `REPORT.md` cruza hallazgos con los fallos de la corrida y genera la sección "Insumos para planificación".
- Regla: los bugs de producto encontrados por los tests NO se arreglan en la batería; se marcan `it.fails` con `// H-0XX` y se registran en `findings.json` para planificar aparte.
