import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { Bindings } from "./env";

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
    },
    plugins: [expo()],
    trustedOrigins: ["photos://", env.BETTER_AUTH_URL].filter(Boolean),
  });
}

export type Auth = ReturnType<typeof createAuth>;
