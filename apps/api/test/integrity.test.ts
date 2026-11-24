import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { media } from "../src/db/schema";
import { authed, createUser, j, sha } from "./helpers";

async function seed(userId: string, seedName: string, fileSize: number, over = {}) {
  const s = sha(seedName);
  const key = `users/${userId}/originals/${s}.jpg`;
  const now = Date.now();
  const id = crypto.randomUUID();
  await getDb(env.DB)
    .insert(media)
    .values({
      id,
      userId,
      sha256: s,
      mediaType: "photo",
      mimeType: "image/jpeg",
      ext: "jpg",
      takenAt: now,
      dateGroup: "2026-11-01",
      width: 100,
      height: 100,
      thumbhash: "AQAAAA==",
      r2KeyOriginal: key,
      r2KeyThumb: `users/${userId}/thumbs/${s}.webp`,
      fileSize,
      thumbSize: 10,
      status: "ready",
      createdAt: now,
      updatedAt: now,
      ...over,
    });
  return { id, key };
}

const scan = (cookie: string, body: Record<string, unknown> = {}) => {
  const a = authed(cookie);
  return SELF.fetch("http://localhost/v1/user/integrity/scan", {
    ...a,
    method: "POST",
    headers: { ...a.headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

describe("integridad R2 vs D1", () => {
  it("todo en orden: sin faltantes ni tamaños distintos", async () => {
    const { cookie, userId } = await createUser();
    const a = await seed(userId, `ok-${userId}`, 5);
    await env.BUCKET.put(a.key, new Uint8Array(5));
    const body = await j(await scan(cookie));
    expect(body.next).toBeNull();
    expect(body.report.checked).toBe(1);
    expect(body.report.missingCount).toBe(0);
    expect(body.report.sizeMismatchCount).toBe(0);
    expect(body.report.checkedAt).not.toBeNull();
  });

  it("detecta original ausente en R2 y tamaño distinto", async () => {
    const { cookie, userId } = await createUser();
    const gone = await seed(userId, `gone-${userId}`, 5);
    const bad = await seed(userId, `bad-${userId}`, 8);
    await env.BUCKET.put(bad.key, new Uint8Array(3));
    const body = await j(await scan(cookie));
    expect(body.report.missingCount).toBe(1);
    expect(body.report.missing[0].id).toBe(gone.id);
    expect(body.report.sizeMismatchCount).toBe(1);
    expect(body.report.sizeMismatch[0]).toMatchObject({
      id: bad.id,
      expectedSize: 8,
      actualSize: 3,
    });
  });

  it("excluye papelera y filas pendientes", async () => {
    const { cookie, userId } = await createUser();
    await seed(userId, `trash-${userId}`, 5, { deletedAt: Date.now() });
    await seed(userId, `pend-${userId}`, 5, { status: "pending" });
    const body = await j(await scan(cookie));
    expect(body.report.checked).toBe(0);
    expect(body.report.missingCount).toBe(0);
  });

  it("no ve datos de otro usuario", async () => {
    const a = await createUser();
    const b = await createUser();
    await seed(a.userId, `other-${a.userId}`, 5);
    const body = await j(await scan(b.cookie));
    expect(body.report.checked).toBe(0);
    expect(body.report.missingCount).toBe(0);
  });

  it("rechaza un cursor fuera del prefijo del usuario", async () => {
    const { cookie } = await createUser();
    const res = await scan(cookie, { startAfter: "users/otro/originals/x.jpg" });
    expect(res.status).toBe(400);
  });

  it("GET devuelve el último informe", async () => {
    const { cookie, userId } = await createUser();
    await seed(userId, `last-${userId}`, 5);
    await scan(cookie);
    const res = await SELF.fetch("http://localhost/v1/user/integrity", authed(cookie));
    const body = await j(res);
    expect(body.report.missingCount).toBe(1);
  });

  it("sin escaneo previo el informe es null", async () => {
    const { cookie } = await createUser();
    const body = await j(await SELF.fetch("http://localhost/v1/user/integrity", authed(cookie)));
    expect(body.report).toBeNull();
  });
});
