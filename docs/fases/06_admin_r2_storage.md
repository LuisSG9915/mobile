# Fase 6: Panel de Administración de Almacenamiento R2

## 🎯 Objetivo

Vista de administrador exclusiva para `luis.sg9915@gmail.com` que muestre el uso agregado de R2 por usuario (bytes, cantidad de medios, porcentaje de cuota) sin exponerla al resto de usuarios.

## 📂 Archivos a Modificar / Crear

1. `apps/api/src/routes/admin.ts` (Nuevo) — montar en el router principal
2. `apps/api/src/env.ts` (`Bindings`) y `apps/api/wrangler.jsonc` (`vars.ADMIN_EMAIL`) + `.dev.vars` / `.dev.vars.example`
3. `packages/shared/src/schemas.ts` (`adminStorageResponseSchema`, `AdminStorageRow`)
4. `apps/mobile/src/api/client.ts` (`adminStorage`)
5. `apps/mobile/src/app/admin.tsx` (Nuevo) — pantalla del panel
6. `apps/mobile/src/app/(tabs)/settings.tsx` — entrada condicional al panel
7. `apps/mobile/src/i18n/es.ts`

## 🛠️ Especificaciones Técnicas

### 1. Gate en el API (`apps/api/src/routes/admin.ts`)

- `ADMIN_EMAIL` definido en `vars` de `wrangler.jsonc` con el valor de producción (`luis.sg9915@gmail.com`) y sobrescrito en `.dev.vars` para dev (regla del repo: vars que difieren dev/prod van en ambos lados).
- En cada handler admin: `if (user.email !== c.env.ADMIN_EMAIL) return 403`. La seguridad vive en el Worker; ocultar el botón en el cliente es solo UX, nunca la barrera.

### 2. Endpoint

- `GET /v1/admin/storage`: join `user` ↔ `userStorageStats` ordenado por `usedBytes` desc. Respuesta:
  ```typescript
  {
    rows: { email: string; usedBytes: number; maxBytes: number; mediaCount: number; usedPercent: number }[];
    totalUsedBytes: number;
    userCount: number;
  }
  ```
  Lectura O(1) por fila gracias a los contadores materializados de `user_storage_stats` (sin `SUM()` sobre `media`).

### 3. Cliente

- `api.adminStorage()` en `api/client.ts`.
- En `settings.tsx`, mostrar la entrada **Almacenamiento R2 (admin)** únicamente si `session.user.email === "luis.sg9915@gmail.com"`.
- Pantalla `app/admin.tsx`: tabla con email, `formatBytes(usedBytes)`, `mediaCount` y % de cuota; totales al pie. Pull-to-refresh con React Query (`["admin-storage"]`).
- Todos los textos en español (`i18n/es.ts`).

## 🧪 Verificación Local

- Test Miniflare: sesión del admin → `200` con la lista; sesión de otro usuario → `403`; sin sesión → `401`.
- Test UI: la entrada de settings solo aparece para el email admin.
