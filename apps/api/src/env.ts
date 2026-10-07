export type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
  UPLOAD_LIMITER?: RateLimit;

  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  PRESIGN_TTL_SECONDS: string;
  MAX_ORIGINAL_BYTES: string;

  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;

  /** Orígenes web permitidos por CORS, separados por coma (ej. "http://localhost:8081,https://photos-web.workers.dev"). */
  WEB_ORIGINS?: string;

  /** Email que habilita las rutas /v1/admin/*; ausente → 403 para todos. */
  ADMIN_EMAIL?: string;
};

export function webOrigins(env: Bindings): string[] {
  return (env.WEB_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
};

export type Variables = {
  user: SessionUser;
  sessionId: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
