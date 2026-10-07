import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import { passwordResetEmail, sendEmail } from "./email";
import { type Bindings, webOrigins } from "./env";

/**
 * Instancia por petición: el binding D1 solo existe dentro del scope de la request.
 */
export function createAuth(env: Bindings) {
  const db = drizzle(env.DB, { schema });
  return betterAuth({
    appName: "Photos",
    database: drizzleAdapter(db, { provider: "sqlite" }),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // Al cambiar la contraseña todas las sesiones quedan revocadas: un
      // dispositivo ajeno pierde acceso inmediatamente tras la recuperación.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        // `url` apunta a /api/auth/reset-password/{token}?callbackURL=…: al
        // abrirlo, el endpoint valida el token y redirige a la app (photos://)
        // o a la web con ?token=…/ ?error=INVALID_TOKEN.
        const ok = await sendEmail(env, { to: user.email, ...passwordResetEmail(url) });
        if (!ok) console.error(`[auth] reset email falló para ${user.id}`);
      },
    },
    // El freno de fuerza bruta lo hace el binding AUTH_LIMITER en index.ts
    // (middleware por IP). El rateLimit nativo de better-auth vive en memoria
    // de la instancia — como createAuth corre por request, nunca acumularía.
    plugins: [expo(), bearer()],
    trustedOrigins: ["photos://", env.BETTER_AUTH_URL, ...webOrigins(env)].filter(Boolean),
  });
}

export type Auth = ReturnType<typeof createAuth>;
