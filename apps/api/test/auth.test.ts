import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { j } from "./helpers";

describe("auth", () => {
  it("registro devuelve sesión con cookie", async () => {
    const res = await SELF.fetch("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({
        email: "ana@test.dev",
        password: "password1234",
        name: "Ana",
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("better-auth");
    const body = await j(res);
    expect(body.user.email).toBe("ana@test.dev");
  });

  it("rutas /v1 sin sesión → 401", async () => {
    const res = await SELF.fetch("http://localhost/v1/timeline");
    expect(res.status).toBe(401);
    const body = await j(res);
    expect(body.error).toBe("unauthorized");
  });

  it("sign-in con password correcta funciona", async () => {
    const res = await SELF.fetch("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({ email: "ana@test.dev", password: "password1234" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("better-auth");
  });
});
