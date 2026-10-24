import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { captureException, withSentry } from "@sentry/cloudflare";
import { cors } from "hono/cors";
import { createAuth } from "./auth";
import { runCleanup } from "./cron/cleanup";
import { type AppEnv, type Bindings, webOrigins } from "./env";
import { requireUser } from "./middleware/session";
import { adminApp } from "./routes/admin";
import { albumsApp } from "./routes/albums";
import { cleanerApp } from "./routes/cleaner";
import { locationsApp } from "./routes/locations";
import { mediaApp } from "./routes/media";
import { searchApp } from "./routes/search";
import { sharedApp } from "./routes/shared";
import { timelineApp } from "./routes/timeline";
import { uploadsApp } from "./routes/uploads";
import { userApp } from "./routes/user";

const app = new OpenAPIHono<AppEnv>({ strict: false });

app.onError((err, c) => {
  console.error("api_error", err);
  // Hono atrapa el error y responde 500: sin esto Sentry no lo vería.
  captureException(err);
  return c.json(
    { error: "internal_error", message: "Algo salió mal. Inténtalo de nuevo en unos segundos." },
    500,
  );
});
app.notFound((c) => c.json({ error: "not_found", message: "Ruta no encontrada." }, 404));

app.use("*", async (c, next) => {
  await next();
  const securityHeaders: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
  try {
    for (const [k, v] of Object.entries(securityHeaders)) {
      c.res.headers.set(k, v);
    }
  } catch {
    // Si c.res tiene cabeceras inmutables (ej. respuestas directas de Better Auth),
    // clonamos la respuesta para poder adjuntar las cabeceras de forma segura.
    const headers = new Headers(c.res.headers);
    for (const [k, v] of Object.entries(securityHeaders)) {
      headers.set(k, v);
    }
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    });
  }
});

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
// Enlaces públicos: sin sesión, pero con rate limit por IP (SHARE_LIMITER).
app.use("/v1/albums/public/*", async (c, next) => {
  const limiter = c.env.SHARE_LIMITER;
  if (limiter) {
    const key = c.req.header("cf-connecting-ip") ?? "anon";
    const { success } = await limiter.limit({ key });
    if (!success) {
      return c.json(
        { error: "rate_limited", message: "Demasiadas solicitudes. Espera un minuto." },
        429,
      );
    }
  }
  c.header("Cache-Control", "private, max-age=60");
  return next();
});
app.use("/v1/*", async (c, next) => {
  // Las rutas públicas no requieren sesión; el resto de /v1 sí.
  if (c.req.path.startsWith("/v1/albums/public/") || c.req.path.startsWith("/v1/shared/")) {
    return next();
  }
  return requireUser(c, next);
});

/**
 * Versión viva del API. `APP_VERSION`/`GIT_SHA` los inyecta el deploy
 * (wrangler `--var`); sin ellos no se puede saber qué commit está en producción.
 */
app.get("/version", (c) =>
  c.json({
    ok: true,
    service: "photos-api",
    version: c.env.APP_VERSION ?? "dev",
    commit: c.env.GIT_SHA ?? "unknown",
    time: new Date().toISOString(),
  }),
);

app.get("/health", (c) => c.json({ ok: true }));
app.all("/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

// eslint-disable-next-line -- encadenado para inferencia de tipos RPC (hc<AppType>)
const v1 = app
  .route("/v1", uploadsApp)
  .route("/v1", timelineApp)
  .route("/v1", mediaApp)
  .route("/v1", albumsApp)
  .route("/v1", locationsApp)
  .route("/v1", searchApp)
  .route("/v1", cleanerApp)
  .route("/v1", sharedApp)
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

const handler = {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(runCleanup(env));
  },
} satisfies ExportedHandler<Bindings>;

// Sin SENTRY_DSN el SDK no se inicializa y el handler queda intacto.
export default withSentry(
  (env) =>
    env.SENTRY_DSN
      ? {
          dsn: env.SENTRY_DSN,
          environment: env.SENTRY_ENVIRONMENT ?? "production",
          tracesSampleRate: 0.1,
        }
      : undefined,
  handler,
);
