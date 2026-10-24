import { describe, expect, it, vi } from "vitest";
import { getDb, isD1TransientError, withD1Retry } from "../src/db/client";
import { user } from "../src/db/schema";

describe("D1 SQLITE_BUSY retry and concurrency resilience", () => {
  it("detecta errores transitorios de D1 correctamente", () => {
    expect(isD1TransientError(new Error("D1_ERROR: SQLITE_BUSY: database is locked"))).toBe(true);
    expect(isD1TransientError(new Error("database is locked"))).toBe(true);
    expect(isD1TransientError(new Error("D1_ERROR: database is overloaded"))).toBe(true);
    expect(isD1TransientError(new Error("table user not found"))).toBe(false);
    expect(isD1TransientError(null)).toBe(false);
  });

  it("withD1Retry reintenta ante SQLITE_BUSY y resuelve al 3er intento", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("D1_ERROR: SQLITE_BUSY");
      }
      return "éxito";
    });

    const result = await withD1Retry(fn, { maxRetries: 4, baseDelayMs: 2 });
    expect(result).toBe("éxito");
    expect(attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("withD1Retry no reintenta si el error no es transitorio", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      throw new Error("D1_ERROR: table user not found");
    });

    await expect(withD1Retry(fn, { maxRetries: 4, baseDelayMs: 2 })).rejects.toThrow(
      "table user not found",
    );
    expect(attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("withD1Retry relanza el error si se agotan los reintentos", async () => {
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      throw new Error("SQLITE_BUSY: database is locked");
    });

    await expect(withD1Retry(fn, { maxRetries: 2, baseDelayMs: 2 })).rejects.toThrow(
      "database is locked",
    );
    expect(attempts).toBe(3); // intento 0 + 2 reintentos
  });

  it("wrapD1 intercepta consultas Drizzle y aplica reintentos automáticos en sentencias", async () => {
    let rawCalls = 0;
    const mockStmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn(),
      run: vi.fn(),
      get: vi.fn(),
      raw: vi.fn(async () => {
        rawCalls++;
        if (rawCalls < 3) {
          throw new Error("D1_ERROR: SQLITE_BUSY");
        }
        // Devuelve formato de raw() esperado por Drizzle: matriz de valores
        return [["u1", "User 1", "test@example.com", 0, null, new Date(0), new Date(0)]];
      }),
    };

    const mockD1: any = {
      prepare: vi.fn(() => mockStmt),
      batch: vi.fn(),
      exec: vi.fn(),
    };

    const db = getDb(mockD1, { maxRetries: 4, baseDelayMs: 2 });
    const rows = await db.select().from(user);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("u1");
    expect(rawCalls).toBe(3);
  });

  it("wrapD1 intercepta batch Drizzle y aplica reintentos automáticos", async () => {
    let batchCalls = 0;
    const mockD1: any = {
      prepare: vi.fn(() => ({
        bind: vi.fn().mockReturnThis(),
      })),
      batch: vi.fn(async () => {
        batchCalls++;
        if (batchCalls < 3) {
          throw new Error("D1_ERROR: database is locked");
        }
        return [
          {
            results: [
              {
                id: "u1",
                email: "test1@example.com",
                name: "User 1",
                email_verified: 0,
                created_at: 0,
                updated_at: 0,
              },
            ],
            success: true,
            meta: {},
          },
          {
            results: [
              {
                id: "u2",
                email: "test2@example.com",
                name: "User 2",
                email_verified: 0,
                created_at: 0,
                updated_at: 0,
              },
            ],
            success: true,
            meta: {},
          },
        ];
      }),
      exec: vi.fn(),
    };

    const db = getDb(mockD1, { maxRetries: 4, baseDelayMs: 2 });
    const res = await db.batch([db.select().from(user), db.select().from(user)]);

    expect(batchCalls).toBe(3);
    expect(res).toHaveLength(2);
  });
});
