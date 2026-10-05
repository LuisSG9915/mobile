// Env bindings para el worker y para `env` en tests (cloudflare:test / cloudflare:workers).
// En producción puedes regenerar esto con `pnpm cf-typegen` (wrangler types).
import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Bindings } from "./src/env";

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
