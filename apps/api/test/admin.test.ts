import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authed, createUser, j } from "./helpers";

const ADMIN = "luis.sg9915@gmail.com";

async function createAdmin() {
  const res = await SELF.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:8787" },
    body: JSON.stringify({ email: ADMIN, password: "password1234", name: "Admin" }),
  });
  if (res.status !== 200) {
    throw new Error(`admin sign-up failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get("set-cookie") ?? "";
  return { cookie: setCookie.split(";")[0] };
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
});
