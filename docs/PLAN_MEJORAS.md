# Plan de trabajo v2 — Confianza, operación y producto

> **Este archivo (`docs/PLAN_MEJORAS.md`) ES el Plan v2.** No existe un `PLAN_V2.md` separado.
> La versión base está en el commit `ea855dd`; las correcciones de esta sesión (I-07/I-08, 15/15,
> Semana, decisiones) siguen sin commitear. Un ZIP de `HEAD` verá la versión base, no esta.
>
> **Estado:** H1 en curso (2026-10-23). Este documento sustituye la lista lineal de etapas 0–5.
> **Regla de oro:** ningún `[x]` sin evidencia enlazada; ningún feature nuevo hasta cerrar H1.
> **Referencias:** [Investigación de huecos](INVESTIGACION_HUECOS_PLAN.md) ·
> [Revisión de cobertura](REVISION_COBERTURA_PLAN.md) · [Decisiones](decisions.md).

---

## 0. Qué cambia

El plan anterior era una lista de **construcción** en 6 etapas. Funcionó para implementar la base,
pero mezclaba construir, entregar y operar, y terminó marcando `[x]` sin que el sistema lo demostrara.

Este plan separa tres preguntas:

1. **H1 — ¿Es verdad y es seguro?** Cerrar P0, tener evidencia, publicar y poder restaurar.
2. **H2 — ¿Se puede operar?** SLOs, alertas, staging, calidad nativa, coste y capacidad.
3. **H3 — ¿Se puede usar y sostener?** Onboarding, accesibilidad, shares, plataforma y documentación.

Las etapas 0–5 pasan a **histórico** (sección 1.3). No se borran: se corrigen sus estados y se
enlazan a evidencia.

---

## 1. Estado real (2026-10-23)

### 1.1 Lo construido y validado

- Worker sin binarios, R2 prefirmado, D1, cola nativa SQLite y web IndexedDB.
- Dedup SHA-256 por usuario, cuota atómica para altas nuevas, papelera 30 días, reconciliación.
- Timeline paginado, FTS5, previews WebP, álbumes, shares, mapa, recuerdos.
- Sesiones revocables, borrado de cuenta, export de metadatos, recuperación de contraseña.
- 376 tests unitarios/integración (144 API + 232 mobile) + 31 de pipeline; lint y typecheck verdes.
- Migraciones sincronizadas: `_journal` **15/15** (0000–0014) con snapshots 0011–0014; `db:generate` responde
  “No schema changes”.

### 1.2 Estado de los hallazgos (P0/P1)

| ID | Hallazgo | Estado | Evidencia actual |
| :--- | :--- | :---: | :--- |
| I-01 | Multipart nativo no completa archivos > 20 MB | **Resuelto (unit)** | `processor.ts` llama `multipartComplete`; test nativo >20 MB |
| I-02 | `multipart/finalize` no valida tamaño/MIME | **Resuelto (unit)** | validación de size/MIME + tests de ensamblado |
| I-03 | “Reanudación” crea MPU nueva y reusa etags viejos | **En progreso** | `upload_id` persistido y `uploadId` reutilizado; falta prueba E2E kill/resume |
| I-04 | Cadena de migraciones | **Resuelto** | snapshots 15/15 (0013/0014 incluidos); `db:generate` sin cambios |
| I-05 | Re-init `pending` no re-reserva cuota | **Resuelto (unit)** | cambio de tamaño → 409; test de re-init |
| I-06 | Límite D1 de 100 parámetros | **Resuelto (unit)** | trozos de 50 en check-hashes/álbumes/export y reconcile; test de 300 hashes |
| I-07 | Cron supera 1.000 queries | **Resuelto (unit)** | cuota agregada por usuario en `cleanup.ts`; falta estrés remoto de 1.200 filas (H2.5) |
| I-08 | `trash/empty` omite previews y puede descontar dos veces | **Resuelto (unit)** | preview incluida; descuento solo si el lote se borró completo; test en `media.test.ts` |
| I-09 | Shares públicos sin paginación/rate limit/originales | **Resuelto (unit)** | tope 500, `SHARE_LIMITER`, `allowDownload=false` por defecto y TTL acotado |
| I-10 | IDOR `coverMediaId` | **Resuelto (unit)** | validación de propiedad en `PATCH /albums/{id}` + test A/B |
| I-11 | Verificación de email sin salida | **En progreso** | 403 reencola con motivo; callbackURL implementado en web/nativo ([verification.ts](../apps/mobile/src/auth/verification.ts), tests en [verification.test.ts](../apps/mobile/src/auth/verification.test.ts) y [auth.test.ts](../apps/api/test/auth.test.ts)); falta prueba con Resend real |
| I-12 | Cola nativa topada en 2.000 | **Abierto P1** | `db.ts:362` |
| I-13 | Web: archivo entero en IndexedDB; visor descarga original | **Abierto P1** | `db.web.ts:298`; `media/[id].tsx:1321-1325` |
| I-14 | Álbum/papelera/salto sin paginar en UI | **Abierto P1** | `use-hybrid-gallery.ts:102-106`; `trash.tsx:15` |
| I-15 | Release/CD sin tag, staging ni rollback | **Abierto P1** | último tag `v1.0.9`; deploy en push |
| I-16 | Backups manuales, mismo bucket, sin restore drill | **En progreso** | runbook documentado en [RESTORE_DRILL.md](ops/RESTORE_DRILL.md) (RPO 24h / RTO 4h); falta ejecución remota con secrets |
| I-17 | Sin heartbeat ni alertas | **En progreso** | `cron_last_run` + `cron-heartbeat.yml`; faltan alertas 5xx/drift y prueba en prod |
| I-18 | Plan sobredeclara estado | **En progreso** | tablero v2 con evidencia; falta cerrar filas con artefactos |

Los IDs remiten a [INVESTIGACION_HUECOS_PLAN.md](INVESTIGACION_HUECOS_PLAN.md). H1 ataca
I-01…I-05, I-07, I-08, I-10, I-11 e I-15…I-17. H2 valida en remoto I-06/I-09 y cierra I-12…I-14 e I-18.

### 1.3 Histórico de las etapas 0–5

| Etapa | Qué se construyó | Qué falta / veredicto |
| :--- | :--- | :--- |
| 0 | Invalidación única, distinción 413, docs y cifras | `decisions.md` sigue con pendientes; checklist operativo no cerrado → **parcial** |
| 1 | Cuota atómica, sweep con cursor, papelera paginada, backups D1 | Bypass por multipart/re-init; previews en `trash/empty`; restore no probado → **parcial** |
| 2 | Paginación, FTS5, `before`, previews | Sin benchmarks; UI de álbum/papelera/salto; límites D1 → **parcial** |
| 3 | Multipart, preview, cola, galería | Nativo y `finalize` corregidos; falta E2E kill/resume; web `ArrayBuffer`; cola 2.000; sin desglose de cuota → **parcial** |
| 4 | Sesiones, borrado, export, shares, email, admin | Export JSON, no ZIP; shares sin flag/rate; email sin reenvío; IDOR portada → **parcial** |
| 5 | E2E, CI/CD, backup D1, checklist nativo | Sin tag/staging/rollback; smoke opcional; sin cobertura; heartbeat añadido en H1.7 → **no cumple** |

---

## 2. Reglas del plan

1. **Fuente única.** Este documento es el tablero vigente. `ROADMAP.md` y `PLAN_GENERAL.md` quedan
   como histórico y llevan un banner que apunta aquí.
2. **Evidencia primero.** Un `[x]` debe enlazar commit, test, workflow, captura o informe. Sin enlace,
   el estado es `todo` o `in_progress`, nunca `done`.
3. **Estados claros.** `todo` / `in_progress` / `blocked` / `done`; `blocked` exige motivo y dueño.
4. **P0 primero.** Un P0 abierto bloquea cualquier feature nueva. No se abre H3 con H1 abierto.
5. **Resultado, no tarea.** Cada fila dice qué cambia para el usuario o el sistema, no solo qué archivo
   se toca.
6. **Dueño y fecha.** Cada trabajo tiene un responsable y una semana objetivo; si no, no entra.
7. **Riesgo y rollback.** Migraciones/cron/deploy llevan plan de reversa y backup previo.
8. **DoD por horizonte.** H1 no cierra sin sus pruebas, release y restore; H2 sin SLO/alertas/staging;
   H3 sin UX/a11y/documentación.
9. **Revisión semanal.** Viernes: actualizar estados, evidencias, riesgos y siguiente foco.
10. **No “100%”.** Solo se declara al cerrar un horizonte con evidencia reproducible.

**Owner y fechas:** en este plan el owner es Luis; las semanas son relativas al inicio de H1 y se
revisan cada viernes. H2/H3 permanecen en `todo` hasta cerrar H1.

---

## 3. H1 — Verdad y confianza (semanas 1–3)

**Objetivo:** que el plan no mienta y que el respaldo no pierda datos.
**Salida:** P0 cerrados, release `v1.1.0`, restore drill, seguridad mínima y heartbeat.
**Calendario (owner: Luis):** H1.1–H1.2 → S1; H1.3–H1.5 → S2; H1.6–H1.7 → S3.

| ID | Resultado | Trabajo | Evidencia de cierre | Semana | Estado |
| :--- | :--- | :--- | :--- | :---: | :---: |
| **H1.1** | Vídeos > 20 MB se respaldan y se reanudan | Llamar `multipartComplete` en nativo; persistir `uploadId` en D1; no reusar etags de otra MPU; resolver la colisión de ruta; **ciclo de vida R2 para abortar MPUs incompletas a 7 días (`docs/ops/R2_LIFECYCLE.md`) + `abortStaleMultipartUploads` paginado**; spec E2E `multipart-resume` | Test nativo >20 MB; test API de reanudación; **falta**: E2E con R2 dev (bloqueado por entorno en `test-results/gemini-blockers.md`) y prueba de MPU huérfana | S1 | `in_progress` |
| **H1.2** | La cuota no se puede saltar | Validar `head().size`/MIME/partes en `multipart/finalize`; re-init con tamaño distinto → 409; **incluye I-08**: `trash/empty` borra previews, descuenta `previewSize` y solo resta cuota si el lote se borró completo | [uploads.test.ts](../apps/api/test/uploads.test.ts) (reanudación, size, MIME) y [media.test.ts](../apps/api/test/media.test.ts) (preview) | S1 | `done` |
| **H1.3** | El plan es verificable | Tablero con evidencia; estados reales; banners en ROADMAP/PLAN_GENERAL; `decisions.md` al día | Ningún `[x]` sin enlace; `decisions.md` sin pendientes operativos | S2 | `in_progress` |
| **H1.4** | Hay una release real | `/version` con `APP_VERSION`/`GIT_SHA`; deploy inyecta los vars; `CHANGELOG.md`; `pnpm release:check` (tag SemVer, árbol limpio, migraciones, changelog); workflow **Rollback** + `docs/ops/ROLLBACK.md` | `/version`, rollback y smoke ya están en el commit `ea855dd`; preflight verificado; **falta tag `v1.1.0` y APK** | S2 | `in_progress` |
| **H1.5** | Se puede restaurar | Restore D1 + R2 a entorno nuevo, RPO/RTO documentados; backup D1 fuera del bucket de producción; `backup-r2` falla con errores; runbook en `docs/ops/INCIDENT_RESPONSE.md` | Procedimiento y consultas en [RESTORE_DRILL.md](ops/RESTORE_DRILL.md); falta ejecución remota con secrets y firma de tiempos | S2 | `in_progress` |
| **H1.6** | Seguridad mínima | IDOR cerrado; álbum público limitado (500), `SHARE_LIMITER`, `allowDownload=false` por defecto, URLs acotadas; CSP/HSTS web; reenvío de verificación **con `callbackURL` a la app/web**; smoke sin credenciales en repo | Tests en [verification.test.ts](../apps/mobile/src/auth/verification.test.ts) y [auth.test.ts](../apps/api/test/auth.test.ts); 3 tests shares/IDOR; **falta**: Resend real y headers en prod | S3 | `in_progress` |
| **H1.7** | Un fallo avisa | `cron_last_run` + workflow `cron-heartbeat.yml`; **incluye I-07**: cuota agregada por usuario en el cron (hecho); SLO en `docs/ops/SLO.md` | Heartbeat y batching testeados en [cron-heartbeat.test.ts](../apps/api/test/cron-heartbeat.test.ts); workflow validado estáticamente; **falta**: prueba de alerta en prod (requiere secrets) | S3 | `in_progress` |

**DoD de H1:** `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm test:pipeline` verdes; los tests
nuevos fallan en el código viejo y pasan en el nuevo; `v1.1.0` publicado; restore drill firmado; 0 P0
y 0 hallazgos altos de seguridad abiertos.

---

## 4. H2 — Operar y medir (semanas 4–8)

**Objetivo:** que un fallo se detecte, se entienda y se recupere sin madrugar.
**Calendario (owner: Luis):** H2.1–H2.2 → S4; H2.3–H2.4 → S5–S6; H2.5–H2.6 → S7–S8.

| ID | Resultado | Trabajo | Evidencia | Semana |
| :--- | :--- | :--- | :--- | :---: |
| **H2.1** | SLOs y alertas | 4 SLOs (respaldo, 5xx, cron, restore), dashboards, alertas y on-call de una persona | Simulación de fallo y alerta recibida | S4 |
| **H2.2** | Entrega reversible | Staging real, deploy por tag, canary, rollback probado, `/version` | Deploy y reversa en staging | S4 |
| **H2.3** | Calidad nativa | E2E Android (Maestro/Detox): onboarding, permiso limitado, 30 MB, kill/resume, restore; matriz API 34/35/36 + un físico | Run por release con artefactos | S5 |
| **H2.4** | Calidad de datos | Contract tests, migraciones desde cero, carga 100k, inyección de fallos, cobertura crítica ≥80 % | CI con presupuesto p95 y cobertura | S6 |
| **H2.5** | Límites D1 (validación remota) | El chunking de `check-hashes`/álbumes/export/reconcile ya está en H1 (I-06); H2 valida contra D1 remoto y añade estrés de 1.200 filas, export 101 álbumes y 500 hashes | <1.000 queries; 500 hashes OK; export 101 álbumes OK | S7 |
| **H2.6** | Coste y capacidad | Modelo R2/D1/Workers/IA/Sentry, presupuesto mensual, alertas, rate limits de abuso | Informe mensual y alerta de gasto | S8 |

**DoD de H2:** SLO con alerta probada; staging + rollback; E2E nativo en 2 dispositivos; cobertura y
carga en CI; informe de coste con umbral.

---

## 5. H3 — Producto y sostenibilidad (semanas 9–16)

**Objetivo:** que el respaldo se entienda, se use y se mantenga.
**Calendario (owner: Luis):** H3.1–H3.2 → S9–S11; H3.3–H3.4 → S12–S14; H3.5 → S15–S16.

| ID | Resultado | Trabajo | Evidencia | Semana |
| :--- | :--- | :--- | :--- | :---: |
| **H3.1** | Onboarding y restore comprensibles | Journeys: primer arranque → permisos → primer backup → verificación → liberar espacio → restore; estados vacío/error/offline; notificaciones | Test con 5 usuarios; tiempo al primer backup <5 min | S9 |
| **H3.2** | Accesibilidad e i18n | TalkBack/VoiceOver, roles/labels/acciones, reduce motion, contraste, catálogo de textos | Auditoría y fixes en las 5 pantallas | S10 |
| **H3.3** | Shares y cuenta completos | Paginación, descarga configurable, revocación, re-autenticación para borrar, export ZIP o decisión documentada | Tests de abuso y restore de export | S12 |
| **H3.4** | Plataforma decidida | ADR iOS/Play/PWA; si no, fuera del checklist y del plan | ADR firmado | S13 |
| **H3.5** | Documentación sostenible | ADRs, runbooks, arquitectura, changelog, onboarding técnico | Docs enlazados y revisados | S15 |

**DoD de H3:** usuario nuevo completa el primer backup sin ayuda; a11y auditada; shares/export
probados; decisión de plataforma; documentación operativa completa.

---

## 6. Métricas y SLOs

| Área | Métrica | Objetivo |
| :--- | :--- | :--- |
| Confianza | % de biblioteca seleccionada respaldada | ≥99 % |
| Confianza | Restore exitoso en drill | 100 % |
| Integridad | Checksum mismatch / drift de cuota | 0 |
| Disponibilidad | Upload success / API 5xx | ≥99 % / <0.5 % |
| Operación | Cron diario / alerta <5 min | 100 % / sí |
| Recuperación | RTO / RPO | <4 h / <24 h |
| Seguridad | Hallazgos altos abiertos >30 días | 0 |
| Autorización | Rutas con test A/B de ownership | 100 % |
| Calidad | Cobertura módulos críticos | ≥80 % |
| Calidad | Flake rate / E2E pass | <2 % / ≥99 % |
| Producto | Primer backup completado | ≥80 % de altas |
| Producto | Tiempo al primer backup | <5 min |
| Coste | Coste mensual por usuario | Presupuesto definido |
| Plan | Etapas con evidencia enlazada | 100 % |

---

## 7. Riesgos

| Riesgo | Prob. | Impacto | Mitigación H1/H2 |
| :--- | :---: | :---: | :--- |
| Pérdida de fotos por restore no probado | Media | **Existencial** | H1.5 restore drill + offsite |
| Exposición por IDOR/share | Media | Alto | H1.6 tests A/B + límites |
| Coste por cuota/IA | Media | Alto | H1.2 + H2.6 presupuesto |
| APK obsoleto | Alta | Alto | H1.4 tag + APK + `/version` |
| Incidente sin runbook | Media | Alto | H2.1 alertas + runbooks |
| Burnout / deuda | Media | Alto | H2.6 + H3.5 + presupuesto de mantenimiento |
| Plan teatro | Alta | Medio | Regla de evidencia + revisión semanal |

---

## 8. Decisiones de H1 (propuestas; confirmar en la semana 1)

La crítica externa tiene razón: H1.2/H1.5/H1.7 no pueden cerrarse con estas decisiones abiertas. Se
adoptan como **defaults operativos** y se revisan al cerrar H1:

| # | Decisión | Default propuesto | Estado |
| :-- | :--- | :--- | :---: |
| 1 | Producto personal o multiusuario | **Personal** (una cuenta, sin colaboración); multiusuario pasa a H3.4 | Propuesto |
| 2 | iOS / Play Store en 2026 | **No**; Android + web. iOS queda en P2 y fuera del checklist | Propuesto |
| 3 | RPO / RTO | **RPO 24 h / RTO 4 h** (backup D1 diario + restore drill) | Propuesto |
| 4 | Presupuesto mensual | Definir antes de H2.6; techo inicial: free tier de R2/D1/Workers + Sentry free | Pendiente de cifra |
| 5 | On-call | **Luis, best-effort** (sin 24/7); alertas por email; sin SLA contractual | Propuesto |
| 6 | Cuota 10 GB | **Dura** (`STORAGE_QUOTA_BYTES`); el usuario debe liberar papelera | Propuesto |
| 7 | Plan v2 como tablero único | **Adoptado** el 2026-10-23; `ROADMAP`/`PLAN_GENERAL` históricos con banner | Adoptado |

> Si alguna propuesta no se acepta, se cambia aquí antes de tocar H1.2/H1.5/H1.7.

---

## 9. Backlog no ahora (P2)

Se revisa al cerrar H2; no antes.

| Idea | Por qué esperar | Criterio para promover |
| :--- | :--- | :--- |
| App iOS publicada | Cuenta/perfiles/QA; foco Android/web | H3.4 + presupuesto |
| Álbumes colaborativos | Cambia permisos y shares | H3.3 + threat model |
| PWA/offline completo | Requiere caché de originales | H2.3 + coste |
| Live Photos (HEIC+MOV) | Cambia modelo de media/dedup | H2.4 + datos |
| Reconocimiento de personas | Coste/privacidad | H3.2 + consentimiento |
| Preview de vídeo transcodificado | CPU/coste | H2.6 + demanda |
| Dedup global entre usuarios | Rediseño de claves | H2.6 + ahorro medido |
| Limpieza automática de espacio | Después de cuota/UX | H3.1 + opt-in |

---

## 10. Anexo: evidencia y enlaces

- Investigación técnica completa: [INVESTIGACION_HUECOS_PLAN.md](INVESTIGACION_HUECOS_PLAN.md).
- Revisión de cobertura (insumo del Plan v2): [REVISION_COBERTURA_PLAN.md](REVISION_COBERTURA_PLAN.md).
- Decisiones de diseño: [decisions.md](decisions.md).
- Pruebas: [docs/testing/PLAN_PRUEBAS.md](testing/PLAN_PRUEBAS.md).
- Baseline actual: 144 API + 232 mobile + 31 pipeline; `pnpm lint` 232 archivos; `db:generate` sin
  cambios.
- Etapas 0–5: histórico en la sección 1.3; los detalles de implementación quedan en el historial de
  git y en `docs/fases/`.

**Regla final:** si una tarea no tiene evidencia, no está hecha. Si un horizonte no tiene su DoD, no
se abre el siguiente.
