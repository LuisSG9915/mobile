# Plan de pulido — nov 2026

Origen: auditoría por áreas (UI/UX, rendimiento Android, funciones, robustez API) sobre
[PLAN_MEJORAS.md](PLAN_MEJORAS.md) y [PROPUESTA_PRODUCTO_2026-11.md](PROPUESTA_PRODUCTO_2026-11.md).
Hallazgos marcados "sin verificar" se confirman antes de editar. Dispositivo de prueba: adb `LMR-L29` (Android 12).
Compilación: dev-client ya instalado (`com.photosR2.app` 1.1.1); solo se recompila si cambia una dependencia nativa.

## Fase 0 — Base verde (bloqueante)
- [ ] 7 tests rojos en `apps/mobile/src/queue/processor.test.ts` (multipart, reanudación, 403 `email_unverified`, 404/409).
- [ ] Lint: import sin usar `albums/[id].tsx`, formato `app.json` y `feature-flags.ts`, warnings `noNonNullAssertion`.
- [ ] Commitear en bloques coherentes los 78 archivos pendientes.

## Fase 1 — Rápidos de alto impacto
| ID | Tarea | Ruta |
| :-- | :-- | :-- |
| U1 | `ErrorState` con "Reintentar"; usar `isError` antes del vacío | `ui/index.tsx`, albums/[id], trash, map, cleaner, search, (tabs)/albums |
| A1 | Trocear `inArray` en cleanup, `.max()` en `deleteIds`, contar filas reales | `api/routes/cleaner.ts:136`, `shared/schemas.ts:477` |
| F1 | Mapa: `fetchNextPage` más allá de 500 | `map.tsx:63` |
| R3 | Cuadrícula de álbum con la celda de galería (recyclingKey, cachePolicy) | `albums/[id].tsx:303`, `shared/album/[token].tsx:288` |
| A2 | Geocodificación secuencial + límite por usuario + User-Agent con contacto | `api/routes/locations.ts:274`, `api/lib/geo.ts:63` |
| A3 | `.max(200)` y tope de tokens en búsqueda | `shared/schemas.ts:491`, `api/routes/search.ts:140` |
| U2 | Spinner ghost/outline visible en claro; `sm` ≥ 48dp | `ui/index.tsx:39,50` |

## Fase 2 — Producto y fluidez
- R1/R2 mapa: arrastre con shared value (reanimated), clustering por celda y zoom.
- F2 restaurar biblioteca al teléfono (A1 propuesta); F3 verificar biblioteca (A2).
- U3 accesibilidad (labels), U4 textos a `es.ts`, U5 `toUserMessage(err)`.
- A4 orden por relevancia FTS (JOIN `media_fts`, rank).
- F6 mensaje claro ante 413 del álbum compartido.

## Fase 3 — Después
- F5 notificaciones/PWA, F7 similitud perceptual en limpiador, R4 + dividir `media/[id].tsx` (~1.830 líneas), F4 UI de etiquetado IA/geocodificación en lote.
- Cerrar H1 restante: I-12 a I-17 de PLAN_MEJORAS.

## Verificación por fase
`pnpm lint && pnpm typecheck && pnpm test`; luego recarga JS en el móvil por adb y captura de las pantallas tocadas.
