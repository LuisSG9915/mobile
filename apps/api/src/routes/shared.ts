import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { errorSchema } from "@photos/shared";
import type { AppEnv } from "../env";

/**
 * Rutas públicas heredadas.
 *
 * El álbum público vive ahora en `GET /albums/public/{token}` (albumsApp) para
 * aplicar el rate limit por IP de `SHARE_LIMITER` y limitar el tamaño/URLs.
 * Esta ruta se mantiene **solo como compatibilidad**: responde 410 con la ruta
 * nueva para que ningún enlace antiguo filtre contenido sin límites.
 */
const legacySharedRoute = createRoute({
  method: "get",
  path: "/shared/album/{token}",
  tags: ["shared"],
  summary: "Ruta pública heredada (deprecada)",
  description:
    "Los enlaces públicos se sirven en /albums/public/{token}. Aquí se responde 410 para no exponer contenido sin rate limit.",
  request: { params: z.object({ token: z.string().min(1) }) },
  responses: {
    410: {
      content: { "application/json": { schema: errorSchema } },
      description: "Enlace heredado: usar /albums/public/{token}",
    },
  },
});

export const sharedApp = new OpenAPIHono<AppEnv>().openapi(legacySharedRoute, (c) => {
  return c.json(
    {
      error: "gone",
      code: "legacy_share_url",
      message: "Este enlace ha cambiado de dirección. Pide al dueño un enlace nuevo.",
    },
    410,
  );
});
