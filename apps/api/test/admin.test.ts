import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { userStorageStats } from "../src/db/schema";
import { authed, createUser, initBody, j } from "./helpers";

const ADMIN = "luis.sg9915@gmail.com";

let adminCookieCache: string | null = null;

async function createAdmin() {
  if (adminCookieCache) return { cookie: adminCookieCache };
  const res = await SELF.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:8787" },
    body: JSON.stringify({ email: ADMIN, password: "password1234", name: "Admin" }),
  });
  if (res.status === 200) {
    const setCookie = res.headers.get("set-cookie") ?? "";
    adminCookieCache = setCookie.split(";")[0];
    return { cookie: adminCookieCache };
  }
  const loginRes = await SELF.fetch("http://localhost/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:8787" },
    body: JSON.stringify({ email: ADMIN, password: "password1234" }),
  });
  if (loginRes.status !== 200) {
    throw new Error(`admin auth failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const setCookie = loginRes.headers.get("set-cookie") ?? "";
  adminCookieCache = setCookie.split(";")[0];
  return { cookie: adminCookieCache };
}

describe("admin", () => {
  it("GET /v1/admin/storage → 200 para el admin con filas y totales", async () => {
    const { cookie } = await createAdmin();
    await createUser(); // otro usuario sin stats también aparece

    const res = await SELF.fetch("http://localhost/v1/admin/storage", authed(cookie));
    expect(res.status).toBe(200);
    const json = await j(res);
    expect(json.userCount).toBe(2);
    expect(json.rows.length).toBe(2);
    expect(json.totalUsedBytes).toBe(0);
    expect(json.rows.map((r: { email: string }) => r.email)).toContain(ADMIN);
    for (const r of json.rows) {
      expect(r.usedBytes).toBe(0);
      expect(r.usedPercent).toBe(0);
    }
  });

  it("GET /v1/admin/storage → 403 para no admin, 401 sin sesión", async () => {
    const { cookie } = await createUser();
    const res = await SELF.fetch("http://localhost/v1/admin/storage", authed(cookie));
    expect(res.status).toBe(403);

    const anon = await SELF.fetch("http://localhost/v1/admin/storage");
    expect(anon.status).toBe(401);
  });

  it("POST /v1/admin/users/:id/reconcile → 403 para no admin, 401 sin sesión", async () => {
    const user = await createUser();
    const target = await createUser();

    const anon = await SELF.fetch(`http://localhost/v1/admin/users/${target.userId}/reconcile`, {
      method: "POST",
    });
    expect(anon.status).toBe(401);

    const nonAdmin = await SELF.fetch(
      `http://localhost/v1/admin/users/${target.userId}/reconcile`,
      authed(user.cookie, { method: "POST" }),
    );
    expect(nonAdmin.status).toBe(403);
  });

  it("POST /v1/admin/users/:id/reconcile → 404 para usuario inexistente", async () => {
    const { cookie } = await createAdmin();
    const res = await SELF.fetch(
      "http://localhost/v1/admin/users/no-such-user-id/reconcile",
      authed(cookie, { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });

  it("POST /v1/admin/users/:id/reconcile → 200 reconcilia almacenamiento y devuelve previous/current", async () => {
    const { cookie: adminCookie } = await createAdmin();
    const user = await createUser();

    // El usuario inicia una subida que reserva bytes
    const initRes = await SELF.fetch(
      "http://localhost/v1/uploads/init",
      authed(user.cookie, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(initBody({ fileSize: 1_000_000, thumbSize: 8_000 })),
      }),
    );
    expect(initRes.status).toBe(201);

    // Simulamos un desfase (drift) artificial en user_storage_stats
    const db = getDb(env.DB);
    await db
      .update(userStorageStats)
      .set({ usedBytes: 500_000, reservedBytes: 200_000 })
      .where(eq(userStorageStats.userId, user.userId));

    // El admin ejecuta la reconciliación
    const recRes = await SELF.fetch(
      `http://localhost/v1/admin/users/${user.userId}/reconcile`,
      authed(adminCookie, { method: "POST" }),
    );
    expect(recRes.status).toBe(200);

    const data = await j(recRes);
    expect(data.ok).toBe(true);
    expect(data.userId).toBe(user.userId);
    expect(data.previous).toEqual({ usedBytes: 500_000, reservedBytes: 200_000 });
    // Esperado actual: 0 usados, 1_008_000 reservados por la subida pendiente
    expect(data.current).toEqual({ usedBytes: 0, reservedBytes: 1_008_000 });
    expect(typeof data.reconciledAt).toBe("string");

    // Segunda ejecución: idempotente con previous = current
    const recRes2 = await SELF.fetch(
      `http://localhost/v1/admin/users/${user.userId}/reconcile`,
      authed(adminCookie, { method: "POST" }),
    );
    expect(recRes2.status).toBe(200);
    const data2 = await j(recRes2);
    expect(data2.previous).toEqual({ usedBytes: 0, reservedBytes: 1_008_000 });
    expect(data2.current).toEqual({ usedBytes: 0, reservedBytes: 1_008_000 });
  });
});
