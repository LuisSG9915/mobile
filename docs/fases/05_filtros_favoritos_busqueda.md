# Fase 5: Favoritos, Chips de Filtro y Salto Temporal

## 🎯 Objetivo

Permitir marcar fotos como favoritas, filtrar el timeline con chips (**Todo / Fotos / Videos / Favoritos**) y saltar directamente a un mes/año concreto sin hacer scroll manual.

## 📂 Archivos a Modificar / Crear

1. `apps/api/src/db/schema.ts` (+ migración drizzle)
2. `apps/api/src/routes/media.ts` (toggle favorito)
3. `apps/api/src/routes/timeline.ts` (parámetro `filter`)
4. `packages/shared/src/schemas.ts` (`favoriteResponseSchema`, tipo `TimelineFilter`)
5. `apps/mobile/src/api/client.ts` (`toggleFavorite`, `timeline` con filtro)
6. `apps/mobile/src/app/(tabs)/index.tsx` (barra de chips, badge de corazón)
7. `apps/mobile/src/app/media/[id].tsx` (botón favorito en el visor)
8. `apps/mobile/src/lib/timeline.ts` / `use-hybrid-gallery.ts` (salto temporal)
9. `apps/mobile/src/i18n/es.ts`

## 🛠️ Especificaciones Técnicas

### 1. Schema (`apps/api/src/db/schema.ts`)

- Agregar a `media`: `isFavorite: integer("is_favorite", { mode: "boolean" }).notNull().default(false)`.
- Índice compuesto para el filtro: `index("media_favorites").on(t.userId, t.isFavorite, t.deletedAt, t.takenAt)`.
- Generar migración con `pnpm --filter @photos/api db:generate` y aplicar local con `db:migrate:local`. Prohibido `--remote`.

### 2. Endpoints

- `POST /v1/media/{id}/favorite`: alterna `isFavorite` y devuelve `{ isFavorite }`. Solo sobre `status = 'ready'` y `deletedAt IS NULL`.
- `GET /v1/timeline?filter=all|photos|videos|favorites`: `photos`/`videos` filtran por `mediaType`; `favorites` por `isFavorite = 1`. Mantener la paginación por cursor existente y el orden `takenAt` desc.
- Salto temporal: aceptar `?before=YYYY-MM-DD` (sobre `dateGroup`) para que el scroll pueda pedir la página que contiene esa fecha sin recorrer todo el timeline.

### 3. Cliente móvil/web

- `api.timeline(cursor, limit, filter)` y `api.toggleFavorite(id)` en `api/client.ts`; invalidar `["timeline"]` tras el toggle.
- Barra de chips bajo el header de `(tabs)/index.tsx` (scroll horizontal si no caben); chip activo con estado visual claro. El filtro vive en el store para sobrevivir a la navegación.
- Badge de corazón en la esquina de la miniatura cuando `isFavorite`; botón corazón en `media/[id].tsx` junto a Descargar/Eliminar.
- **Salto temporal**: botón que abre un bottom-sheet con la lista de `Mes Año` disponibles (derivada de los `dateGroup` ya cargados o consulta distinta); al elegir, `flatListRef.scrollToIndex` al header de ese grupo, pidiendo `?before=` primero si aún no está cargado.

## 🧪 Verificación Local

- Tests API con Miniflare: toggle de favorito idempotente, `filter=favorites` solo devuelve marcados, `filter=videos` excluye fotos, `?before=` respeta el `dateGroup`.
- Sin llamadas a Cloudflare real en ningún test.
