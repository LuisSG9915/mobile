# Revisión de cobertura del plan: qué falta después de la investigación

> **Estado:** adoptado el 2026-10-23; el plan vigente es [`PLAN_MEJORAS.md`](PLAN_MEJORAS.md)
> (Plan v2, H1 en curso).
>
> **Fecha:** 2026-10-23 · **Objeto:** `docs/PLAN_MEJORAS.md` y el sistema de planificación del proyecto.
> **Pregunta:** ya aplicada la investigación técnica, ¿qué otras áreas del plan inicial conviene mejorar?
> **Método:** contraste del plan con el árbol actual, los documentos de operación y los artefactos de
> calidad/seguridad existentes. No es una segunda auditoría de código; es una revisión de cobertura.

---

## 0. Conclusión en cinco puntos

1. **El plan cubre bien el “construir”; no cubre el “operar, proteger, medir ni sostener”.** Las 6
   etapas son de implementación. No hay SLOs, respuesta a incidentes, modelo de amenazas, política de
   privacidad, accesibilidad, i18n, coste ni ciclo de vida de la documentación.
2. **El plan actualizado sobredeclara.** Marca el DoD como “Auditada y Cumplida”, pero el árbol actual
   sigue con los P0 de multipart nativo y bypass de cuota, y con varias tareas de las etapas 3–5 sin
   cumplir. La primera área a mejorar no es una feature: es el **sistema de evidencia y cierre**.
3. **El plan mide entregables, no resultados.** “Etapa 3 completada” no dice si un vídeo de 1 GB se
   respalda, si una foto se restaura o si un enlace público se puede revocar. Faltan métricas de
   resultado y criterios de aceptación verificables por un tercero.
4. **Hay 10 áreas de cobertura ausentes o débiles.** Las prioritarias: evidencia/gobernanza,
   confiabilidad y recuperación, seguridad/autorización, privacidad, calidad de ingeniería, UX,
   accesibilidad, rendimiento, coste/abuso y entrega/plataforma.
5. **Propuesta:** un Plan v2 en tres horizontes (**cerrar y asegurar → operar y medir → productizar**),
   con SLOs, presupuesto de coste y un tablero único. No abriría nuevas funciones hasta cerrar el
   primer horizonte.

---

## 1. Qué se aplicó de la investigación (y qué no)

### 1.1 Aplicado y verificable

- **Migraciones:** `apps/api/migrations/meta/0011_snapshot.json` y `0012_snapshot.json` existen; el
  journal y los snapshots están 13/13. Verificado: `db:generate` responde “No schema changes, nothing
  to migrate”.
- **Documentación:** `README.md` y `ROADMAP.md` actualizaron las cifras a 132/228 + 27 pipeline;
  `PLAN_IMPLEMENTACION_DEVIN.md` añadió la línea base.
- **Plan:** `PLAN_MEJORAS.md` se reescribió como “implementado y auditado”; se añadió la sección 7 de
  verificación y se marcó el DoD.

### 1.2 No aplicado en el árbol actual

| Punto de la investigación | Estado actual | Evidencia |
| :--- | :--- | :--- |
| I-01 · multipart nativo completa | **Abierto** | `apps/mobile/src/queue/processor.ts:345` sigue llamando `completeUpload`, no `multipartComplete` |
| I-02 · validación de tamaño en multipart | **Abierto** | `apps/api/src/routes/uploads.ts:855-915` solo comprueba existencia, no `head().size` |
| I-05 · re-init `pending` no reserva | **Abierto** | `uploads.ts:317` sigue con `bytesToReserve = existing?.status === "pending" ? 0 : totalBytes` |
| I-06 · límite de 100 parámetros D1 | **Abierto** | `check-hashes` acepta 500; `free-space` envía todos |
| I-07 · cron > 1.000 queries | **Abierto** | una query por fila en `cleanup.ts:42-88` |
| I-09 · share sin rate limit/originales | **Abierto** | `shared.ts:61-92` devuelve todo y siempre `originalUrl`/`downloadUrl` |
| I-10 · IDOR `coverMediaId` | **Abierto** | `albums.ts:509-513` no valida pertenencia |
| I-11 · verificación de email sin salida | **Abierto** | 403 `email_unverified` tratado como sesión; sin reenvío en el cliente |
| I-12 · cola nativa 2.000 | **Abierto** | `db.ts:362` |
| I-13 · web archivo entero / visor original | **Abierto** | `db.web.ts:298`; `media/[id].tsx:1321-1325` |
| I-14 · álbum/papelera/salto sin paginar | **Abierto** | `use-hybrid-gallery.ts:102-106`; `trash.tsx:15` |
| I-15 · release/CD/rollback | **Abierto** | último tag `v1.0.9`, anterior al plan; deploy en push; smoke opcional |
| I-16 · backups verificables/offsite | **Abierto** | `backup-r2.mjs` exit 0 con errores; D1 al mismo bucket |
| I-17 · heartbeat/alertas | **Abierto** | sin `cron_last_run` ni alertas versionadas |
| I-18 · plan operativo | **Empeorado** | el DoD ahora está `[x]` sin evidencia; `decisions.md` sigue con pendientes |

> Si los P0 se aplicaron en otra rama o en otro checkout, esta revisión se hizo sobre `master` +
> working tree actual. En ese caso, el primer trabajo es alinear el árbol y el plan; hoy no coinciden.

### 1.3 La contradicción del plan actualizado

`PLAN_MEJORAS.md` dice en la sección 1 que el checklist operativo está cerrado y en la sección 6 que
el DoD se cumplió. Pero:

- La sección 2 sigue listando M-01 con “`PLAN_IMPLEMENTACION_DEVIN.md` con `[ ]`” y M-02 con
  “`EXPO_PUBLIC_ADMIN_EMAIL` no está en `eas.json`”, cuando la sección 1 dice que ya se corrigieron.
- `docs/decisions.md:151-155` sigue diciendo que `AUTH_LIMITER` necesita deploy y que Resend está
  pendiente.
- El DoD dice “UI probado en dev-client/Android” y “R2 mock/dev” sin artefacto, log ni checklist.
- El DoD llama “plan de rollback” a tener snapshots de migraciones; un snapshot no es un plan de
  rollback.
- Etapa 3 sigue `[x]` aunque el multipart nativo no funcione; Etapa 4 sigue `[x]` aunque el export no
  sea ZIP; Etapa 5 sigue `[x]` aunque no haya tag, staging, cobertura ni alertas.

**Esto no es un detalle burocrático:** un plan que marca `[x]` sin evidencia hace que la siguiente
sesión (humana o agente) construya sobre arena. Es el hueco más caro de todos.

---

## 2. Lo que el plan sí cubre bien

Para no perder lo bueno:

- **Arquitectura y flujo de datos:** Worker sin binarios, R2 prefirmado, D1, cola híbrida, papelera.
- **Integridad básica:** cuota atómica para altas nuevas, dedup SHA-256, sweep con cursor, reconciliación.
- **Escala de lectura:** paginación, FTS5, previews, índices.
- **Ciclo de cuenta:** sesiones, borrado, exportación de metadatos (aunque no sea ZIP).
- **Calidad base:** 375 tests, lint, typecheck, E2E web, CI, backup D1 diario.
- **Decisiones explícitas:** sección 8 (“no se tocan”) y backlog P2 con razones.
- **Secuenciación:** dependencias y estimaciones, aunque no se contrastaron con la realidad.

El plan es un buen **plan de construcción**. Lo que falta es el plan de **operación y confianza**.

---

## 3. Mapa de cobertura

| Dimensión | Cobertura | Evidencia / ausencia |
| :--- | :---: | :--- |
| Construcción de features | **Alta** | Etapas 0–5, 375 tests, CI |
| Verificación y evidencia | **Baja** | `[x]` sin artefacto; P0 abiertos; DoD marcado sin logs |
| Producto y descubrimiento | **Nula** | No hay user journeys, métricas de uso, onboarding ni research |
| UX/UI y accesibilidad | **Baja** | Sin auditoría a11y; celdas sin rol/fecha; scrubber solo-gesto |
| Calidad de ingeniería | **Media** | Unit + E2E web; sin E2E nativo, contrato, carga, migraciones ni caos |
| Seguridad | **Baja/Media** | Auth y rate limit; IDOR abierto, shares sin límites, sin threat model, web sin CSP |
| Privacidad/legal | **Baja** | IA/geo sin consentimiento; sin política de privacidad, ToS ni retención documentada |
| Confiabilidad/SRE | **Baja** | Sin SLO/SLI, heartbeat, alertas, on-call ni runbooks de incidente |
| Datos/DR | **Baja/Media** | Backups manuales, mismo bucket, sin restore drill; migraciones sin política expand/contract |
| Rendimiento/escala | **Baja** | Sin presupuesto en CI, sin dataset 100k, sin benchmarks; límites D1 ignorados |
| Entrega/release | **Baja/Media** | Deploy en push, sin staging/tag/rollback; APK atrás; sin `/version` |
| Coste/sostenibilidad | **Baja** | Sin unit economics, presupuesto, alertas de gasto ni modelo de abuso |
| Plataforma (Android/iOS/web) | **Media** | Android/web; iOS sin publicar; matriz nativa manual |
| Gobernanza/documentación | **Baja** | Tres tableros, sin owners/fechas/riesgos/ADRs; docs desincronizados |
| Soporte/operación | **Nula** | Sin canal de soporte, SLA, status page ni postmortems |

**Lectura:** el plan es fuerte en “build”, aceptable en “assure” básico y débil/nulo en “run”,
“protect”, “measure” y “sustain”.

---

## 4. Las 10 áreas que faltan (y cómo empezarlas)

### A1 · Sistema de evidencia y gobernanza del plan

**Qué falta.** Un `[x]` no está ligado a un commit, test, artefacto o comando reproducible. No hay
estado por hallazgo (abierto/resuelto), propietario, fecha, riesgo ni registro de decisiones. Hay tres
tableros (`ROADMAP`, `PLAN_GENERAL`, `PLAN_MEJORAS`) que se contradicen.

**Evidencia.** `PLAN_MEJORAS.md:302-312` marca el DoD `[x]`; `decisions.md:151-155` sigue pendiente;
la sección 2 del plan conserva hallazgos con evidencia vieja.

**Primeras acciones.**
- Tablero único con columnas: ID, resultado, estado, evidencia (commit/test/artefacto), owner, fecha,
  riesgo, dependencia.
- Regla: ningún `[x]` sin enlace a una prueba o artefacto; los P0 abiertos no pueden coexistir con
  “100%”.
- Archivar `ROADMAP`/`PLAN_GENERAL` como histórico y dejar `PLAN_MEJORAS` (o un `PLAN_V2`) como fuente
  de verdad.
- Un ADR por decisión relevante (cuota, multipart, shares, IA, retención).

**Cierre.** Un revisor externo puede reconstruir el estado del proyecto solo con el tablero.

### A2 · Confiabilidad y respuesta a incidentes (SRE)

**Qué falta.** No hay SLO/SLI, presupuesto de error, heartbeat del cron, alertas, on-call, runbooks de
incidente, status page ni postmortems. El plan dice “observabilidad” pero solo implementó Sentry
opcional.

**Evidencia.** `apps/api/src/index.ts:133-135` solo hace `waitUntil(runCleanup)`; no hay
`cron_last_run`; `wrangler.jsonc` no declara Analytics; `docs/ops/OBSERVABILITY.md` solo cubre Sentry.

**Primeras acciones.**
- Definir 4 SLOs: respaldo exitoso ≥99%, API 5xx <0.5%, cron diario 100%, restore RTO <4 h.
- Persistir `cron_last_run` y alertar si >26 h; alerta de backup fallido y de drift de cuota.
- Runbooks: D1 corrupta, R2 inaccesible, token filtrado, deploy malo, cuota agotada.
- Un canal de alerta real (email/Telegram/Sentry) y una prueba mensual.

**Cierre.** Se puede simular un fallo de cron/backup y la alerta llega en <5 min; el runbook se ejecutó
al menos una vez.

### A3 · Recuperación real (DR) y backups offsite

**Qué falta.** El backup de originales es manual y termina en `exit 0` con errores; el backup D1 vive
en el mismo bucket de producción; la retención es un comando manual; no hay restore drill ni RPO/RTO
declarados.

**Evidencia.** `scripts/backup-r2.mjs:267-283`; `.github/workflows/backup-d1.yml:85-90`;
`docs/ops/D1_BACKUP.md:46-124`.

**Primeras acciones.**
- `exit 1` si hay errores; job programado con `--verify-sample`.
- Destino offsite (otra cuenta/bucket o disco cifrado) y retención versionada.
- Restore drill mensual a una base nueva + smoke de lectura; registrar tiempo y resultado.
- Declarar RPO/RTO y probarlos.

**Cierre.** Un restore completo desde cero se hizo en <RTO y el informe está en `docs/ops/`.

### A4 · Seguridad de autorización y superficie pública

**Qué falta.** No hay modelo de amenazas ni tests sistemáticos de ownership. Hay un IDOR de portada,
shares públicos sin rate limit ni flag de descarga, CSP/HSTS ausentes en la web, y credenciales de
smoke hardcodeadas.

**Evidencia.** `albums.ts:509-513`; `shared.ts:61-92`; `apps/mobile/wrangler.jsonc` sin `_headers`;
`prod-smoke.mjs:17-18`.

**Primeras acciones.**
- Threat model STRIDE para uploads, shares, admin, borrado y auth.
- Suite de autorización: cada recurso (`media`, `album`, `cover`, `share`, `session`) con usuario A/B.
- Shares: paginación, rate limit, `allowDownload`, revocación de URLs.
- Web: CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`; rotar credenciales de smoke.
- Dependabot/secret scanning y revisión de permisos del token de CI.

**Cierre.** 0 IDOR en la suite; un álbum público grande no puede amplificar CPU; CSP en producción.

### A5 · Privacidad, consentimiento y ciclo de vida del dato

**Qué falta.** La app envía miniaturas a Workers AI y GPS a BigDataCloud/Nominatim sin aviso ni
opt-out. No hay política de privacidad, ToS, inventario de datos, retención documentada ni flujo de
DSAR beyond export JSON. El borrado de cuenta no pide re-autenticación.

**Evidencia.** `apps/api/src/lib/ai.ts`, `apps/api/src/lib/geo.ts`, `apps/api/src/routes/user.ts:239-301`.

**Primeras acciones.**
- Inventario: qué dato, dónde vive, quién lo ve, cuánto se retiene, cómo se borra.
- Consentimiento explícito para IA/geo (opt-in) y opción de desactivarlo.
- Política de privacidad/ToS y enlace en onboarding; formulario de datos de Play Store.
- Borrado con contraseña; export ZIP restaurable o decisión documentada.

**Cierre.** Un usuario puede ver qué se comparte, desactivarlo y borrar todo; la política está publicada.

### A6 · Calidad de ingeniería más allá de unit tests

**Qué falta.** No hay E2E nativo, matriz de dispositivos, tests de contrato, tests de migraciones,
carga/estrés, inyección de fallos, regresión visual, accesibilidad ni umbral de cobertura. El E2E web
solo corre Chromium y usa `expo start`, no el export de producción.

**Evidencia.** `package.json` sin coverage; `playwright.config.ts` un solo project; 375 tests no
cubren multipart >20 MB ni bypass de cuota.

**Primeras acciones.**
- E2E nativo (Maestro/Detox) para onboarding, permiso limitado, subida 30 MB, kill/resume, restore.
- Contract tests shared schema ↔ API; migration test que aplique todas las migraciones desde cero.
- Load test con 100k filas y presupuesto p95; fallos inyectados (R2 500, D1 busy, red lenta).
- Cobertura mínima en cola/processor/storage/auth; flake budget y cuarentena.

**Cierre.** Un cambio que rompe el respaldo de vídeo falla en CI antes de mergear.

### A7 · Producto y UX: los flujos que deciden si el respaldo se usa

**Qué falta.** No hay user journeys, onboarding, explicación de cuota/papelera/shares, estados
vacío/error/offline, primer respaldo guiado, restore guiado, ni notificaciones de éxito/fallo. La UI
asume que el usuario entiende “local vs nube”, “pendiente” y “papelera”.

**Evidencia.** No hay `docs/product/`; el plan solo habla de features; la galería muestra “sin fotos”
cuando falla la red (auditoría cliente S-01).

**Primeras acciones.**
- Journey map: primer arranque → permisos → primer backup → verificación → liberar espacio → restore.
- Onboarding de 3 pasos: qué se respalda, cuota, qué pasa si borras.
- Estados explícitos: sin conexión, permiso limitado, cuota llena, verificación pendiente, backup pausado.
- Medir: tiempo al primer backup, % de biblioteca respaldada, éxito de restore.

**Cierre.** Un usuario nuevo completa el primer backup sin ayuda y entiende dónde están sus fotos.

### A8 · Accesibilidad e internacionalización

**Qué falta.** No hay auditoría a11y, roles/labels/acciones en celdas y scrubber, reduce motion,
dynamic type ni arquitectura i18n (los textos viven en `i18n/es.ts`, pero el diseño asume español).

**Evidencia.** `index.tsx:126-127`, `FastScrubber.tsx:169-174`; no hay tests de a11y.

**Primeras acciones.**
- Auditoría TalkBack/VoiceOver de las 5 pantallas principales.
- Roles/labels/estado de selección/fecha en celdas; alternativa al scrubber; acciones de zoom.
- Respetar reduce motion y tamaño de fuente; contraste AA.
- Extraer textos a un catálogo con claves y preparar una segunda locale (aunque sea de prueba).

**Cierre.** Las 5 pantallas se pueden usar con lector de pantalla; no hay texto hardcodeado en JSX.

### A9 · Rendimiento, capacidad y coste

**Qué falta.** No hay presupuesto de rendimiento en CI, ni benchmarks con dataset real, ni modelo de
coste por usuario, ni alertas de gasto. Los límites de D1 (100 parámetros/1.000 queries) y R2
(partes/objetos) no están en el plan. La IA y el geocoding externos no tienen presupuesto.

**Evidencia.** `PLAN_MEJORAS.md:157-159` pide medir, pero no hay benchmark; no hay `docs/ops/COST.md`;
`check-hashes` y cron superan límites.

**Primeras acciones.**
- Dataset sintético 100k/1M y benchmarks de timeline/search/meses; presupuesto p95 en CI.
- Modelo de coste: R2 GB-mes, D1 reads/writes, Workers, IA, Sentry; alerta mensual.
- Rate limits y cuotas de abuso en shares, IA y geocode; límites de array y batch.
- Capacidad: qué pasa a 10k/100k/1M fotos; plan de sharding o archivado.

**Cierre.** Se conoce el coste por usuario y el p95; un aumento de 10× no rompe el Worker.

### A10 · Entrega, plataforma y sostenibilidad

**Qué falta.** No hay staging, tag-driven release, canary, feature flags, rollback probado ni
`/version`. El APK va por detrás del web. iOS no está decidido. No hay changelog, deprecación de API,
política de dependencias ni plan de mantenimiento.

**Evidencia.** `ci.yml:98-148`; `release-apk.yml:3-5`; `git tag --contains 23b6c54` vacío.

**Primeras acciones.**
- Staging real + deploy por tag + `environment` con aprobación + rollback probado.
- `/version` con commit y build; changelog y release notes.
- Decidir iOS/Play Store (sí/no/fecha) y reflejarlo en el plan.
- Política de dependencias (Renovate/Dependabot), Node fijo y auditoría de licencias AGPL.
- Presupuesto de mantenimiento: % de tiempo por semana para deps, docs y deuda.

**Cierre.** Un tag produce API+web+APK verificables y reversibles; la versión viva se puede consultar.

---

## 5. Plan v2: tres horizontes

La estructura lineal “Etapa 0 → 5” ya no sirve: mezcla construir, entregar y operar. Propongo tres
horizontes con resultados, no tareas.

### H1 · “Verdad y confianza” (2–3 semanas)

**Objetivo:** que el plan y el producto digan la verdad, y que el respaldo no pierda datos.

| Resultado | Trabajo | Evidencia |
| :--- | :--- | :--- |
| P0 cerrados | Multipart nativo, validación de tamaño, re-init de cuota | Tests que fallan hoy y pasan después |
| Plan honesto | Tablero con estado/evidencia; retirar `[x]` sin prueba | `PLAN_MEJORAS` con enlaces a tests/commits |
| Release real | Tag `v1.1.0`, APK, `/version`, changelog | APK instalado + `/version` |
| Restore probado | Drill D1 + R2, RPO/RTO documentados | Informe de restore con tiempos |
| Seguridad mínima | IDOR, shares, CSP, credenciales smoke | Tests A/B y headers en prod |

**Salida:** no se abre una feature nueva hasta que H1 esté verde.

### H2 · “Operar y medir” (4–8 semanas)

**Objetivo:** que un fallo se detecte y se pueda recuperar sin madrugar.

| Resultado | Trabajo | Evidencia |
| :--- | :--- | :--- |
| SLOs y alertas | 4 SLOs, heartbeat, alertas de backup/drift/5xx | Simulación de fallo + alerta |
| Staging y rollback | Entorno, tag, canary, rollback | Deploy y reversa en staging |
| Calidad nativa | E2E Android, matriz API 34/35/36, 1 físico | Run por release |
| Calidad de datos | Contract/migration/load/failure tests | CI con presupuesto p95 |
| Coste | Modelo, presupuesto y alertas | Informe mensual |

### H3 · “Producto y sostenibilidad” (9–16 semanas)

**Objetivo:** que el respaldo se entienda, se use y se mantenga.

| Resultado | Trabajo | Evidencia |
| :--- | :--- | :--- |
| Onboarding y restore | Journeys, permisos, estados, notificaciones | Test con 5 usuarios |
| Accesibilidad | TalkBack/VoiceOver, reduce motion, contraste | Auditoría y fixes |
| Shares y cuenta | Límites, descarga configurable, revocación, re-auth | Tests de abuso |
| Plataforma | Decisión iOS/Play/PWA | ADR y plan |
| Documentación | ADRs, runbooks, arquitectura, changelog | Docs enlazados y frescos |

---

## 6. Métricas que faltan (y que harían el plan verificable)

| Área | Métrica | Objetivo sugerido |
| :--- | :--- | :--- |
| Confianza | % de biblioteca seleccionada respaldada | ≥99% |
| Confianza | Restore exitoso en drill | 100% |
| Integridad | Checksum mismatch / drift de cuota | 0 |
| Disponibilidad | Upload success / API 5xx | ≥99% / <0.5% |
| Operación | Cron diario ejecutado / alerta <5 min | 100% / sí |
| Recuperación | RTO / RPO | <4 h / <24 h |
| Seguridad | Hallazgos altos abiertos >30 días | 0 |
| Autorización | Tests A/B de ownership | 100% rutas |
| Calidad | Cobertura módulos críticos | ≥80% |
| Calidad | Flake rate / E2E pass | <2% / ≥99% |
| Producto | Primer backup completado | ≥80% de altas |
| Producto | Tiempo al primer backup | <5 min |
| Coste | Coste mensual por usuario | Presupuesto definido |
| Plan | Etapas con evidencia enlazada | 100% |

Sin estas métricas, “100%” seguirá siendo una opinión.

---

## 7. Riesgos de no hacerlo

| Riesgo | Prob. | Impacto | Señal |
| :--- | :---: | :---: | :--- |
| Pérdida de fotos por restore no probado | Media | **Existencial** | El backup existe, pero nunca se restauró |
| Exposición de fotos por IDOR/share | Media | Alto | Portada/link accesible por otro usuario |
| Coste inesperado por cuota/IA | Media | Alto | `used_bytes` no cuadra con R2; factura sube |
| APK obsoleto | Alta | Alto | El usuario no recibe los fixes |
| Incidente sin runbook | Media | Alto | Nadie sabe qué hacer si D1/R2 falla |
| Burnout del maintainer | Media | Alto | Deuda y soporte sin presupuesto |
| Plan teatro | Alta | Medio | `[x]` sin evidencia; decisiones sobre datos falsos |

---

## 8. Preguntas para decidir el alcance

1. **¿El producto es personal o multiusuario?** Cambia seguridad, privacidad, coste y soporte.
2. **¿iOS y Play Store están en 2026?** Si no, sacarlo del plan y del checklist.
3. **¿Cuál es el RPO/RTO aceptable?** Sin eso, no se puede diseñar el backup.
4. **¿Cuál es el presupuesto mensual?** R2, D1, Workers, IA, Sentry; define límites y alertas.
5. **¿Quién atiende un incidente?** Si es una persona, el SLO y el on-call deben ser realistas.
6. **¿La cuota de 10 GB es dura o blanda?** Define abuso, coste y mensajes de UX.
7. **¿Se adopta un Plan v2 o se actualiza el actual?** Recomiendo un tablero único, no tres documentos.

---

## 9. Anexo: artefactos que faltan

| Artefacto | Para qué |
| :--- | :--- |
| `docs/security/THREAT_MODEL.md` | Autorización, shares, admin, abuso |
| `docs/security/PRIVACY.md` | Inventario de datos, IA/geo, retención, DSAR |
| `docs/ops/SLO.md` | SLO/SLI, error budget, alertas |
| `docs/ops/INCIDENT_RESPONSE.md` | Runbooks y escalado |
| `docs/ops/RESTORE_DRILL.md` | Evidencia de restore y RTO/RPO |
| `docs/ops/COST.md` | Unit economics y presupuesto |
| `docs/product/JOURNEYS.md` | Onboarding, backup, restore, shares |
| `docs/adr/` | Decisiones con contexto y consecuencias |
| `.github/ISSUE_TEMPLATE/` | Backlog con IDs, prioridad y evidencia |
| `CHANGELOG.md` | Versiones y notas de release |
| `docs/ops/VERSION.md` o `/version` | Saber qué commit está vivo |

---

**Cierre.** El plan inicial hizo bien lo difícil: construir el flujo de respaldo y una base de tests
respetable. Lo que falta es lo que convierte un prototipo en un servicio en el que se confía: evidencia,
recuperación, seguridad, privacidad, calidad nativa, UX, coste y sostenibilidad. La prioridad no es
añadir otra etapa de features; es cerrar la brecha entre lo que el plan dice y lo que el sistema
demuestra.
