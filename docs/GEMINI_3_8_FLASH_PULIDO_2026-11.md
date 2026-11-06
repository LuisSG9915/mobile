# Guion de ejecución para Gemini 3.8 Flash — Tramo 1: pulido de honestidad

> **Cómo usarlo:** abre el repo en Gemini 3.8 Flash (checkout real, no un ZIP), copia el bloque
> **PROMPT** completo y ejecútalo. Las secciones siguientes son el detalle que el agente consulta
> cuando el prompt lo indica.
>
> **Alcance deliberado:** solo P-01, P-02, P-03, P-04, P-09, P-10 y P-11 de
> [`PROPUESTA_PRODUCTO_2026-11.md`](PROPUESTA_PRODUCTO_2026-11.md) §3. Son bugs de honestidad y
> paridad; no son features nuevos. Restaurar, verificar, OCR, viajes, dedup, PWA y share target
> quedan **fuera** hasta que H1 cierre.
>
> **Regla que manda:** si H1 sigue abierto, este tramo no añade capacidades nuevas. El guion
> general del repo es [`GEMINI_3_8_FLASH_PLAN.md`](GEMINI_3_8_FLASH_PLAN.md); este lo especializa.

---

## PROMPT

```text
Eres un agente de ingeniería en el monorepo "Photos Platform" (Expo + React Native + Cloudflare
Workers/D1/R2). Trabajas en el checkout actual, no en un ZIP. Tu objetivo es ejecutar el Tramo 1 de
docs/PROPUESTA_PRODUCTO_2026-11.md: cerrar los bugs de honestidad y paridad P-01, P-02, P-03, P-04,
P-09, P-10 y P-11. No implementes features nuevos.

CONTEXTO OBLIGATORIO (léelo antes de tocar nada):
- docs/PROPUESTA_PRODUCTO_2026-11.md §3 (hallazgos) y §7.2 (tramo "Ahora").
- docs/PLAN_MEJORAS.md: Plan v2, H1 en curso; regla de evidencia.
- AGENTS.md y apps/mobile/AGENTS.md.
- docs/GEMINI_3_8_FLASH_PLAN.md (reglas generales; este guion las especializa).
- docs/GEMINI_3_8_FLASH_PULIDO_2026-11.md (este documento).

REGLAS DURAS:
1. No ejecutes `git push`, `git tag`, `wrangler deploy`, `wrangler d1 execute --remote`, `eas build`
   ni ninguna acción remota o destructiva.
2. No toques producción ni R2 real. Este tramo no necesita `.dev.vars` ni E2E con R2.
3. No modifiques migraciones, snapshots ni el esquema de D1.
4. No ejecutes `pnpm install` si hay un `expo start` vivo. No compiles builds nativos.
5. No reformatees el repo entero. `pnpm lint` puede estar rojo por CRLF preexistente: captura el
   baseline, no arregles archivos ajenos y usa `pnpm exec biome check --write <archivos tocados>`
   solo sobre lo que edites.
6. No uses `git add -A`. Agrupa los commits por fix y revisa `git diff` antes de stagear.
7. No marques filas de docs/PLAN_MEJORAS.md. Este tramo no cierra H1 ni H2/H3.
8. La UI y los mensajes visibles van en español. Los textos nuevos van a
   apps/mobile/src/i18n/es.ts; no inventes un sistema i18n nuevo.
9. Si algo no se puede verificar, no lo declares hecho: escribe el bloqueo con comando y error.
10. Si un test falla por una causa ajena a tu cambio, párate y repórtalo; no lo desactives.

FASE 0 — Reconocimiento (no edites nada)
- Ejecuta: git status --short; git log -1 --oneline; node -v; pnpm -v.
- Comprueba si hay un Expo zombie en :8081 (Get-NetTCPConnection o lsof) y si existe
  apps/api/.dev.vars (solo informativo; este tramo no lo usa).
- Lee los archivos de las fases 1-5 y el test de pipeline de cabeceras.
- Devuelve un plan de 6 líneas: qué harás, qué puede quedar bloqueado y qué no tocarás.

FASE 1 — Línea base
- Ejecuta, en este orden: pnpm typecheck; pnpm --filter @photos/mobile test; pnpm test:pipeline.
- Ejecuta `pnpm lint` una vez y guarda el número de errores como baseline. NO lo arregles.
- Si typecheck, mobile tests o pipeline fallan por causa ajena, PARA y reporta. No sigas sobre una
  base rota.

FASE 2 — P-01: quitar el "enlace público" falso del visor
- Archivo: apps/mobile/src/ui/ShareMediaModal.tsx.
- Elimina el bloque JSX "Enlace público rápido..." completo (selector de caducidad + copiar),
  el estado `expiresIn`, el handler `handleCopyLink` y el import `Copy` si queda sin uso.
- No añadas `expo-clipboard` ni un endpoint nuevo en este tramo. No toques el share de álbum
  (apps/mobile/src/app/albums/[id].tsx), que sí funciona.
- Deja un comentario breve: "Enlace público real pendiente (P-01/H3.3): no mostrar hasta que exista
  token con caducidad, descarga opcional y revocación."
- Verifica que no quedan usos: `rg "handleCopyLink|expiresIn|navigator.clipboard" \
  apps/mobile/src/ui/ShareMediaModal.tsx` debe salir vacío.
- Criterio de aceptación: el modal ya no promete un enlace que no existe; no hay código muerto;
  `pnpm typecheck` pasa.

FASE 3 — P-02: paridad real del editor
- Crea apps/mobile/src/lib/image-editor-calc.ts con un helper puro:
  `aspectRatioValue(ratio: AspectRatioOption): number | null` → "original" = null, "1:1" = 1,
  "4:3" = 4/3, "16:9" = 16/9, "9:16" = 9/16.
- Usa el helper en apps/mobile/src/lib/image-editor.ts y apps/mobile/src/lib/image-editor.web.ts;
  elimina los if/else duplicados de `targetRatio`.
- Web: implementa de verdad 9:16. Hoy el editor web solo contempla 1:1, 4:3 y 16:9, así que 9:16
  cae a 1:1.
- Nativo: sustituye `MediaLibrary.saveToLibraryAsync(result.uri)` por
  `MediaLibrary.createAssetAsync(result.uri)`. Si devuelve un asset, encólalo con
  `enqueueAsset({ id: asset.id, uri: asset.uri, filename: asset.filename ?? ..., mediaType: "photo",
  creationTime: asset.creationTime })`; si falla, haz fallback a `saveToLibraryAsync` y registra el
  warning. No falles el guardado por no poder encolar.
- En apps/mobile/src/ui/PhotoEditorModal.tsx, tras guardar, dispara
  `runBackupPass().catch(() => {})` (import desde ../../queue/runner) para no esperar al siguiente
  escaneo.
- Añade apps/mobile/src/lib/image-editor-calc.test.ts con 5 casos: original, 1:1, 4:3, 16:9, 9:16.
- Criterio de aceptación: web y nativo usan el mismo helper; el test cubre 9:16; el nativo encola
  la edición; `rg "createAssetAsync|enqueueAsset" apps/mobile/src/lib/image-editor.ts` encuentra
  ambos; no hay un segundo `9 / 16` hardcodeado en el web.

FASE 4 — P-03: paginar la papelera
- Archivo: apps/mobile/src/app/trash.tsx.
- Sustituye `useQuery` por `useInfiniteQuery`:
  - `queryKey: ["trash"]`
  - `queryFn: ({ pageParam }) => api.trash({ cursor: pageParam, limit: 100 })`
  - `initialPageParam: undefined as string | undefined`
  - `getNextPageParam: (last) => last.nextCursor ?? undefined`
- Aplana `data.pages.flatMap((p) => p.items)`, añade `onEndReached={fetchNextPage}` con un footer
  de carga y `RefreshControl` que invalide la query.
- Mantén las mutaciones de restaurar y vaciar. No añadas "restaurar todo" en este tramo.
- Criterio de aceptación: `rg "useInfiniteQuery|getNextPageParam" trash.tsx` encuentra ambos; el
  test de API `apps/api/test/media.test.ts:224` sigue verde; la papelera vacía no regresiona.

FASE 5 — P-04: CSP del mapa
- Archivo: apps/mobile/public/_headers.
- Añade `https://*.basemaps.cartocdn.com` a `img-src` (conserva el resto de la directiva).
- Extiende el test existente "la web declara cabeceras de seguridad (_headers) para CSP/HSTS" en
  scripts/test-pipeline.test.mjs con:
  `assert.match(src, /img-src[^;]*basemaps\.cartocdn\.com/);`
- No implementes clustering en este tramo; queda para post-H1.
- Criterio de aceptación: `pnpm test:pipeline` verde; `rg "basemaps.cartocdn.com"` encuentra la
  cabecera y el test. Si puedes abrir la web, confirma que una tesela carga; si no, dilo.

FASE 6 — P-09/P-10/P-11: textos, accesibilidad y versión
- P-09 (i18n): añade claves a apps/mobile/src/i18n/es.ts para los textos hardcodeados que toques
  (como mínimo `settings.sessionRevoked`, `settings.exportedJson`, `settings.exported`,
  `settings.nothingToFree` y `backup.resendNeedsLogin`). Reemplaza los literales en
  apps/mobile/src/app/(tabs)/settings.tsx y apps/mobile/src/app/(tabs)/backup.tsx.
- P-10 (a11y): en apps/mobile/src/ui/index.tsx, `Button` debe exponer
  `accessibilityState={{ disabled: disabled || loading, busy: loading }}`. En la celda de la
  galería, el `Pressable` de `PhotoCell` debe exponer `accessibilityState={{ selected }}` y un
  label que distinga foto/video y selección. No rediseñes la pantalla.
- P-11: en apps/mobile/app.json, sube `version` a "1.1.0" y elimina
  "android.permission.FOREGROUND_SERVICE_DATA_SYNC" (no hay servicio que lo use). No toques
  READ_MEDIA_* ni el resto de permisos. No compiles: el cambio aplica en el próximo build nativo.
- Criterio de aceptación: no quedan los literales indicados en settings/backup; `rg
  "accessibilityState"` encuentra `Button` y `PhotoCell`; app.json declara 1.1.0 y no declara
  DATA_SYNC; `pnpm typecheck` pasa.

FASE 7 — Verificación
- Ejecuta: pnpm typecheck; pnpm --filter @photos/mobile test; pnpm test:pipeline.
- Ejecuta `pnpm exec biome check <archivos tocados>` (solo esos).
- Ejecuta `node scripts/gemini-gate-pulido.mjs` si existe; debe pasar.
- Ejecuta `pnpm lint` otra vez y compara el número de errores con el baseline: no debe aumentar.
  Si aumenta por tus archivos, corrígelos; si es por archivos ajenos, repórtalo.
- Opcional y solo si el entorno lo permite: `pnpm --filter @photos/mobile test:e2e`. Si levanta
  servidores y falla por puertos ocupados, regístralo como bloqueo de entorno, no como fallo del
  cambio.

FASE 8 — Commits por bloques (sin push)
- Revisa `git diff --stat` y `git diff`. No mezcles archivos ajenos.
- Bloques sugeridos:
  A) fix(share): oculta el enlace público falso — ShareMediaModal.tsx
  B) fix(editor): paridad 9:16 y encolado nativo — image-editor*.ts, PhotoEditorModal.tsx, test
  C) fix(trash): paginación por cursor — trash.tsx
  D) fix(web): CSP del mapa — public/_headers, scripts/test-pipeline.test.mjs
  E) fix(a11y,i18n): textos, estados y versión — ui/index.tsx, (tabs)/index.tsx,
     (tabs)/settings.tsx, (tabs)/backup.tsx, i18n/es.ts, app.json
- Usa `git add <rutas>` por bloque y `git commit -m "..."`. No hagas `git add -A`.
- Después de cada bloque: `pnpm typecheck` y el test del área.

FASE 9 — Cierre
- Ejecuta la verificación completa de la Fase 7 una última vez.
- No actualices estados de H1/H2/H3 en docs/PLAN_MEJORAS.md. Si quieres dejar constancia, añade una
  línea en CHANGELOG.md bajo [Unreleased] con los fixes reales, sin prometer features.
- Entrega un informe con:
  1. Tabla fase | estado | evidencia (comando + resultado).
  2. Archivos cambiados, agrupados por commit.
  3. Baseline de lint vs. lint final.
  4. Bloqueos con comando y error exactos.
  5. Qué queda explícitamente fuera (A1/A2, B1, C1/C3, D1/D2, E1/E3, F1/F5).

CRITERIO DE PARADA:
- Typecheck, mobile tests o pipeline fallan por una causa ajena y no trivial.
- El fix exige una dependencia nueva, una migración, un endpoint nuevo o tocar >5 archivos no
  relacionados.
- `expo start` está vivo y hace falta `pnpm install`.
- Un test existente espera el comportamiento falso (por ejemplo, un snapshot del enlace público):
  no lo actualices en silencio; explica el conflicto.
En esos casos: no improvises; escribe el bloqueo exacto y sigue con la fase no bloqueada.

FORMATO DE RESPUESTA FINAL:
1. Tabla fase | estado | evidencia.
2. Archivos cambiados por commit.
3. Comandos ejecutados y resultado.
4. Bloqueos con comando/error exactos.
5. Qué NO se hizo y por qué (H1 abierto).
```

---

## Detalle de las fases

### Fase 0 · Reconocimiento

| Comprobación | Comando |
| :--- | :--- |
| Árbol | `git status --short` |
| HEAD | `git log -1 --oneline` |
| Node/pnpm | `node -v`, `pnpm -v` |
| Expo zombie | `Get-NetTCPConnection -LocalPort 8081` (Windows) o `lsof -nP -iTCP:8081` |
| R2 dev | `Test-Path apps/api/.dev.vars` (solo informativo) |

**Salida esperada:** plan de 6 líneas. No editar todavía.

### Fase 1 · Línea base

```bash
pnpm typecheck
pnpm --filter @photos/mobile test
pnpm test:pipeline
pnpm lint            # guardar el número de errores; no arreglar
```

En este checkout Windows, `pnpm lint` puede fallar por CRLF en archivos preexistentes. Eso **no**
autoriza a reformatear el repo. Se compara el conteo antes/después.

### Fase 2 · P-01 — enlace público

Archivo: [`apps/mobile/src/ui/ShareMediaModal.tsx`](../apps/mobile/src/ui/ShareMediaModal.tsx).

Qué se elimina:

- Estado `expiresIn` (≈ línea 60).
- `handleCopyLink` (≈ líneas 262-281).
- Bloque JSX “Enlace público rápido…” (≈ líneas 468-523).
- Import `Copy` si queda sin uso.

Qué **no** se toca: el share de álbum ([`albums/[id].tsx`](../apps/mobile/src/app/albums/%5Bid%5D.tsx)),
que sí crea un token real.

**Por qué ocultar y no implementar:** un enlace público real por foto es una feature de H3.3
(tokens, caducidad, revocación, rate limit). Este tramo es pulido; el plan prohíbe abrir features
con H1 abierto.

### Fase 3 · P-02 — editor

Archivos:

- [`image-editor.ts`](../apps/mobile/src/lib/image-editor.ts) — nativo.
- [`image-editor.web.ts`](../apps/mobile/src/lib/image-editor.web.ts) — web.
- [`PhotoEditorModal.tsx`](../apps/mobile/src/ui/PhotoEditorModal.tsx) — dispara el respaldo.
- Nuevo: `image-editor-calc.ts` + `image-editor-calc.test.ts`.

El helper puro evita que las dos implementaciones vuelvan a divergir. El test cubre 9:16, que es
justo el caso que hoy falla en web.

**Criterio:** el archivo editado se encola al instante en nativo y en web; 9:16 produce un recorte
9:16 real en ambos.

### Fase 4 · P-03 — papelera

Archivo: [`trash.tsx`](../apps/mobile/src/app/trash.tsx).

La API ya pagina y el cliente ya acepta `{ cursor, limit }`; solo falta que la pantalla los use.
El test de API existente cubre el cursor:
[`media.test.ts:224`](../apps/api/test/media.test.ts).

**Criterio:** 250 elementos en papelera se pueden recorrer y restaurar; no se pierde el estado
vacío ni el botón de vaciar.

### Fase 5 · P-04 — CSP del mapa

Archivos:

- [`public/_headers`](../apps/mobile/public/_headers) — añadir `https://*.basemaps.cartocdn.com`
  a `img-src`.
- [`scripts/test-pipeline.test.mjs`](../scripts/test-pipeline.test.mjs) — extender el test de
  cabeceras.

**Por qué:** las teselas del mapa vienen de `basemaps.cartocdn.com` y el CSP actual solo permite
R2 en `img-src`. En producción web el mapa queda sin teselas. El clustering es otra fase.

### Fase 6 · P-09/P-10/P-11 — textos, a11y y versión

- **P-09:** literales como “Sesión revocada”, “Datos exportados” y
  “Vuelve a iniciar sesión para reenviar la verificación” pasan a `es.ts`.
- **P-10:** `Button` anuncia `disabled`/`busy`; la celda de galería anuncia `selected`.
- **P-11:** `app.json` a 1.1.0 y sin `FOREGROUND_SERVICE_DATA_SYNC` (permiso huérfano, ya
  documentado en H1.9). El cambio de permisos aplica en el próximo build nativo; no compilar.

### Fase 7 · Verificación

```bash
pnpm typecheck
pnpm --filter @photos/mobile test
pnpm test:pipeline
pnpm exec biome check apps/mobile/src/ui/ShareMediaModal.tsx \
  apps/mobile/src/lib/image-editor.ts apps/mobile/src/lib/image-editor.web.ts \
  apps/mobile/src/lib/image-editor-calc.ts apps/mobile/src/lib/image-editor-calc.test.ts \
  apps/mobile/src/ui/PhotoEditorModal.tsx apps/mobile/src/app/trash.tsx \
  apps/mobile/src/ui/index.tsx "apps/mobile/src/app/(tabs)/index.tsx" \
  "apps/mobile/src/app/(tabs)/settings.tsx" "apps/mobile/src/app/(tabs)/backup.tsx" \
  apps/mobile/src/i18n/es.ts apps/mobile/public/_headers \
  scripts/test-pipeline.test.mjs apps/mobile/app.json
node scripts/gemini-gate-pulido.mjs
pnpm lint            # comparar con baseline; no debe aumentar
```

### Fase 8 · Commits

Mensajes sugeridos:

```text
fix(share): oculta el enlace público falso del visor
fix(editor): paridad 9:16 y encolado inmediato de la edición
fix(trash): pagina la papelera por cursor
fix(web): permite las teselas del mapa en el CSP
fix(a11y,i18n): estados accesibles, textos y versión 1.1.0
```

No push, no tag, no deploy.

---

## Definition of Done de este tramo

- [ ] El visor no muestra el bloque de enlace público falso ni conserva código muerto.
- [ ] Editor web y nativo comparten `aspectRatioValue`; 9:16 funciona en web; nativo encola al
      guardar.
- [ ] La papelera pagina con cursor y llega al final de una lista >100.
- [ ] `_headers` permite `basemaps.cartocdn.com` y el test de pipeline lo comprueba.
- [ ] Textos nuevos en `es.ts`; `Button` y `PhotoCell` exponen estado accesible.
- [ ] `app.json` declara 1.1.0 y no declara `FOREGROUND_SERVICE_DATA_SYNC`.
- [ ] `pnpm typecheck`, `pnpm --filter @photos/mobile test` y `pnpm test:pipeline` verdes.
- [ ] `node scripts/gemini-gate-pulido.mjs` verde.
- [ ] `pnpm lint` no aumenta su conteo de errores respecto del baseline.
- [ ] Informe final con evidencia y bloqueos; sin `[x]` en el tablero.

---

## Anti-patrones prohibidos

- Implementar enlaces públicos reales, restauración, OCR, viajes, dedup, PWA o share target en este
  tramo.
- Ejecutar `pnpm lint:fix` global (reformatea 100+ archivos ajenos y ensucia el diff).
- `git add -A` o mezclar los cinco fixes en un commit.
- Desactivar o reescribir un test para que pase.
- Cambiar migraciones, snapshots o esquema.
- Compilar nativo o tocar `android/`.
- Marcar H1/H2/H3 como done.
- Declarar “hecho” sin comando y resultado.

---

## Tramos siguientes (no ejecutar con este prompt)

Cada tramo requiere que H1 esté cerrado y una aprobación humana explícita. Se documentarán en
guiones separados para no mezclar objetivos:

| Tramo | Contenido | Dependencia |
| :--- | :--- | :--- |
| 2 | A1 restaurar + A2 verificar + A3 recibo | H1.5 (restore drill) y release publicada |
| 3 | B1 OCR + B2 consulta natural + B3 filtros de fotógrafo | Decisión de coste de Workers AI |
| 4 | C1 viajes + C2 álbumes inteligentes + C3 recap | Tramo 2 (las descargas ya funcionan) |
| 5 | D1 enlaces reales + D2 share target + E1/E3 espacio y dedup | Tramo 2 + migración aprobada |
| 6 | F1 PWA + F2 i18n + F3 a11y + F4 refactor + F5 E2E nativo | Tramos 2-5 |

La regla sigue siendo la del Plan v2: **si no hay evidencia enlazada, no está hecho.**
