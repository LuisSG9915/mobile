import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { createAuth } from "./auth";
import { runCleanup } from "./cron/cleanup";
import type { AppEnv, Bindings } from "./env";
import { requireUser } from "./middleware/session";
import { mediaApp } from "./routes/media";
import { timelineApp } from "./routes/timeline";
import { uploadsApp } from "./routes/uploads";

const app = new OpenAPIHono<AppEnv>({ strict: false });

app.onError((err, c) => {
  console.error("api_error", err);
  return c.json(
    { error: "internal_error", message: "Algo salió mal. Inténtalo de nuevo en unos segundos." },
    500,
  );
});
app.notFound((c) => c.json({ error: "not_found", message: "Ruta no encontrada." }, 404));

app.use("/v1/*", cors());
app.use("/v1/*", requireUser);

app.get("/health", (c) => c.json({ ok: true }));
app.all("/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

// eslint-disable-next-line -- encadenado para inferencia de tipos RPC (hc<AppType>)
const v1 = app.route("/v1", uploadsApp).route("/v1", timelineApp).route("/v1", mediaApp);

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Photos API",
    version: "1.0.0",
    description:
      "API de respaldo personal de fotos. Los binarios van directo a R2 con URLs prefirmadas; este servicio solo gestiona metadatos y sesiones.",
  },
});
app.get("/docs", apiReference({ spec: { url: "/openapi.json" }, theme: "default" }));

export type AppType = typeof v1;

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(runCleanup(env));
  },
} satisfies ExportedHandler<Bindings>;
