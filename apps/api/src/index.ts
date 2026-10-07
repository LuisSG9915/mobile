import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { createAuth } from "./auth";
import { runCleanup } from "./cron/cleanup";
import { type AppEnv, type Bindings, webOrigins } from "./env";
import { requireUser } from "./middleware/session";
import { adminApp } from "./routes/admin";
import { mediaApp } from "./routes/media";
import { timelineApp } from "./routes/timeline";
import { uploadsApp } from "./routes/uploads";
import { userApp } from "./routes/user";

const app = new OpenAPIHono<AppEnv>({ strict: false });

app.onError((err, c) => {
  console.error("api_error", err);
  return c.json(
    { error: "internal_error", message: "Algo salió mal. Inténtalo de nuevo en unos segundos." },
    500,
  );
});
app.notFound((c) => c.json({ error: "not_found", message: "Ruta no encontrada." }, 404));

// CORS con allowlist: la app web usa Authorization: Bearer (sin cookies de
// terceros), así que credentials no hace falta. Requests sin Origin (móvil,
// CLI) pasan sin cabeceras CORS.
const webCors = (env: Bindings) =>
  cors({
    origin: webOrigins(env),
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["set-auth-token"],
    maxAge: 600,
  });

app.use("/api/auth/*", async (c, next) => webCors(c.env)(c, next));

// Freno de fuerza bruta por IP sobre los endpoints sensibles de auth
// (login, registro y recuperación). En dev/tests el binding no existe → no-op.
const AUTH_SENSITIVE = [
  "/api/auth/sign-in",
  "/api/auth/sign-up",
  "/api/auth/request-password-reset",
  "/api/auth/reset-password",
];
app.use("/api/auth/*", async (c, next) => {
  const limiter = c.env.AUTH_LIMITER;
  if (limiter && c.req.method === "POST" && AUTH_SENSITIVE.some((p) => c.req.path.startsWith(p))) {
    const key = c.req.header("cf-connecting-ip") ?? "anon";
    const { success } = await limiter.limit({ key });
    if (!success) {
      return c.json(
        { error: "rate_limited", message: "Demasiados intentos. Espera un minuto." },
        429,
      );
    }
  }
  return next();
});
app.use("/v1/*", async (c, next) => webCors(c.env)(c, next));
app.use("/v1/*", requireUser);

app.get("/health", (c) => c.json({ ok: true }));
app.all("/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

// eslint-disable-next-line -- encadenado para inferencia de tipos RPC (hc<AppType>)
const v1 = app
  .route("/v1", uploadsApp)
  .route("/v1", timelineApp)
  .route("/v1", mediaApp)
  .route("/v1", userApp)
  .route("/v1", adminApp);

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
