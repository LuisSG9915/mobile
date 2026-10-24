# 🚀 PLAN DE IMPLEMENTACIÓN TÉCNICA - ROADMAP DEV SWE-2

## 📌 Directivas Operativas para el Agente SWE-2
1. **Gestión de Estados**: Cada fase se marca en `docs/PLAN_GENERAL.md` al completarse.
   - Estado pendiente: `[ ] Pendiente`
   - Estado completado: `[x] Completado (Commit: <hash>)`
2. **Enfoque de Commits**: Realizar commits atómicos y descriptivos al finalizar cada sub-tarea.
3. **⚠️ REGLA DE ORO DE CONSUMO Y COSTOS ($0 Cloud Spending)**:
   - **PROHIBIDO** lanzar tests contra la infraestructura real de Cloudflare (D1 o R2 en producción).
   - Todos los tests de la API deben ejecutarse usando emulación local con **Miniflare** (`wrangler dev --local` o mocks de `@cloudflare/workers-types`).
   - Las operaciones de R2 en tests deben ser mockeadas utilizando un mock en memoria o almacenamiento local efímero.
   - Ejecutar `pnpm test` asegurando que no se requieran credenciales activas de Cloudflare ni se envíen peticiones HTTP externas.

---

## 📋 Control de Fases

Las especificaciones detalladas viven en `docs/fases/`; el tablero maestro con estado y commit es `docs/PLAN_GENERAL.md`.

- [x] **Fase 1: Esquema de Datos Optimizado, Deduplicación y Cuota en D1** — `docs/fases/01_d1_dedup_cuotas.md` (Commit: dcdec0f)
- [x] **Fase 2: Optimización de R2, Streaming y Descarga de Archivos** — `docs/fases/02_r2_descargas_cache.md` (Commit: 9befaf6)
- [x] **Fase 3: Pausa Persistente (sin auto-resume) y Anillo de Sincronización** — `docs/fases/03_pausa_y_progreso_sync.md` (Commit: 3fa2eba)
- [x] **Fase 4: Liberar Espacio y Purga de Papelera a 30 días** — `docs/fases/04_liberar_espacio_papelera.md` (Commit: bd67afa)
- [x] **Fase 5: Favoritos, Chips de Filtro y Salto Temporal** — `docs/fases/05_filtros_favoritos_busqueda.md` (Commit: 6ed25ed)
- [x] **Fase 6: Panel Admin de Almacenamiento R2 (luis.sg9915@gmail.com)** — `docs/fases/06_admin_r2_storage.md` (Commit: 423f7fe)
- [x] **Fase 7: Gestos (Zoom, Scrubber, Swipe) y Tests Finales** — `docs/fases/07_ux_gestos_pipeline.md` (Commit: c171624)

---

## 🧪 Línea Base de Validación Local (Post-Etapa 5)

Validación 100% offline ejecutada y verificada:
- **API Tests (Miniflare D1 + R2 en memoria)**: 19 suites, 143 tests aprobados (0 fallos).
- **Mobile Tests (Vitest + happy-dom)**: 22 suites, 232 tests aprobados (0 fallos).
- **Total Tests Unitarios/Integración**: 375 tests aprobados.
- **Pipeline Selftest (`scripts/test-pipeline.test.mjs`)**: 31 tests aprobados.
- **Linter & Tipado**: `pnpm lint` y `pnpm typecheck` limpios en todos los paquetes (`@photos/api`, `@photos/mobile`, `@photos/shared`).
- **Plan v2 (post-Fase 22)**: H1 “Verdad y confianza” en curso. Estado real, P0 abiertos y evidencia en [`docs/PLAN_MEJORAS.md`](../PLAN_MEJORAS.md).
