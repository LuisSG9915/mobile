import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type D1RetryOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
};

export const D1_TRANSIENT_ERROR_REGEX =
  /SQLITE_BUSY|database is locked|D1_ERROR.*(?:busy|locked|overloaded)/i;

export function isD1TransientError(error: unknown): boolean {
  if (!error) return false;
  const msg =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  return D1_TRANSIENT_ERROR_REGEX.test(msg);
}

export async function withD1Retry<T>(fn: () => Promise<T>, options?: D1RetryOptions): Promise<T> {
  const maxRetries = options?.maxRetries ?? 4;
  const baseDelayMs = options?.baseDelayMs ?? 50;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < maxRetries && isD1TransientError(error)) {
        const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 100);
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}

const UNWRAP_D1_STMT = Symbol("UNWRAP_D1_STMT");
const IS_WRAPPED_D1 = Symbol("IS_WRAPPED_D1");

function wrapPreparedStatement(
  stmt: D1PreparedStatement,
  retryOptions?: D1RetryOptions,
): D1PreparedStatement {
  return new Proxy(stmt, {
    get(target, prop, receiver) {
      if (prop === UNWRAP_D1_STMT) {
        return target;
      }
      if (
        prop === "run" ||
        prop === "all" ||
        prop === "raw" ||
        prop === "get" ||
        prop === "first"
      ) {
        return (...args: unknown[]) =>
          withD1Retry(() => (target as any)[prop](...args), retryOptions);
      }
      if (prop === "bind") {
        return (...args: unknown[]) => {
          const bound = (target as any).bind(...args);
          return wrapPreparedStatement(bound, retryOptions);
        };
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
}

export function wrapD1(d1: D1Database, retryOptions?: D1RetryOptions): D1Database {
  if ((d1 as any)[IS_WRAPPED_D1]) return d1;
  return new Proxy(d1, {
    get(target, prop, receiver) {
      if (prop === IS_WRAPPED_D1) return true;
      if (prop === "prepare") {
        return (query: string) => {
          const stmt = target.prepare(query);
          return wrapPreparedStatement(stmt, retryOptions);
        };
      }
      if (prop === "batch") {
        return (statements: D1PreparedStatement[]) => {
          const unwrapped = statements.map((s) => (s as any)[UNWRAP_D1_STMT] ?? s);
          return withD1Retry(() => target.batch(unwrapped), retryOptions);
        };
      }
      if (prop === "exec") {
        return (query: string) => withD1Retry(() => target.exec(query), retryOptions);
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
}

export const getDb = (d1: D1Database, retryOptions?: D1RetryOptions) =>
  drizzle(wrapD1(d1, retryOptions), { schema });

export type Db = ReturnType<typeof getDb>;
