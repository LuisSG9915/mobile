import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { j } from "./helpers";

const WEB = "http://localhost:8081"; // en la allowlist de WEB_ORIGINS del test env

describe("cors + bearer (web)", () => {
  it("preflight OPTIONS a /v1/* desde origen permitido → 204 con CORS", async () => {
    const res = await SELF.fetch("http://localhost/v1/timeline", {
      method: "OPTIONS",
      headers: {
        origin: WEB,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization, content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "authorization",
    );
  });

  it("preflight desde origen no permitido → sin allow-origin", async () => {
    const res = await SELF.fetch("http://localhost/v1/timeline", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("OPTIONS a /api/auth/* → CORS y set-auth-token expuesto", async () => {
    const res = await SELF.fetch("http://localhost/api/auth/sign-in/email", {
      method: "OPTIONS",
      headers: {
        origin: WEB,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(res.headers.get("access-control-expose-headers")).toContain("set-auth-token");
  });

  it("sign-up desde web devuelve set-auth-token y /v1 acepta Bearer", async () => {
    const res = await SELF.fetch("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB },
      body: JSON.stringify({ email: "web@test.dev", password: "password1234", name: "Web" }),
    });
    expect(res.status).toBe(200);
    const token = res.headers.get("set-auth-token");
    expect(token).toBeTruthy();

    const stats = await SELF.fetch("http://localhost/v1/stats", {
      headers: { authorization: `Bearer ${token}`, origin: WEB },
    });
    expect(stats.status).toBe(200);
    expect(stats.headers.get("access-control-allow-origin")).toBe(WEB);
    const body = await j(stats);
    expect(body.count).toBeDefined();
  });

  it("Bearer inválido → 401", async () => {
    const res = await SELF.fetch("http://localhost/v1/stats", {
      headers: { authorization: "Bearer token-falso", origin: WEB },
    });
    expect(res.status).toBe(401);
  });
});
