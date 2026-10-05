import { createMiddleware } from "hono/factory";
import { createAuth } from "../auth";
import type { AppEnv } from "../env";

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: "unauthorized", message: "Inicia sesión para continuar." }, 401);
  }
  c.set("user", session.user);
  c.set("sessionId", session.session.id);
  await next();
});
