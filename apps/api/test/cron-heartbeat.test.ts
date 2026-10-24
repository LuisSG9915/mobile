/**
 * Guardarraíl de H1.7: el cron de limpieza debe dejar rastro de cada corrida
 * en `system_state.cron_last_run`. Si el cron deja de ejecutarse, este dato es
 * lo que permite alertar (ver docs/ops/SLO.md).
 */
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runCleanup } from "../src/cron/cleanup";
import { getDb } from "../src/db/client";
import { systemState } from "../src/db/schema";

type Stored = { ok: boolean; startedAt: number; finishedAt: number | null; error?: string };

async function readHeartbeat(): Promise<Stored | null> {
  const db = getDb(env.DB);
  const row = await db.select().from(systemState).where(eq(systemState.key, "cron_last_run")).get();
  return row?.value ? (JSON.parse(row.value) as Stored) : null;
}

describe("cron heartbeat", () => {
  it("runCleanup deja cron_last_run con inicio, fin y ok=true", async () => {
    const before = Date.now();
    await runCleanup(env);
    const hb = await readHeartbeat();

    expect(hb).not.toBeNull();
    expect(hb?.ok).toBe(true);
    expect(hb?.startedAt).toBeGreaterThanOrEqual(before);
    expect(hb?.finishedAt).toBeGreaterThanOrEqual(hb?.startedAt ?? Number.POSITIVE_INFINITY);
    expect(hb?.finishedAt).toBeLessThanOrEqual(Date.now());
  });

  it("una corrida posterior actualiza el latido (upsert, no duplica)", async () => {
    await runCleanup(env);
    const first = await readHeartbeat();
    await new Promise((r) => setTimeout(r, 20));
    await runCleanup(env);
    const second = await readHeartbeat();

    const db = getDb(env.DB);
    const rows = await db.select().from(systemState).where(eq(systemState.key, "cron_last_run"));
    expect(rows.length).toBe(1);
    expect(second?.finishedAt).toBeGreaterThan(first?.finishedAt ?? 0);
  });
});
