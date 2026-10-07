import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { j } from "./helpers";

const EMAIL = "reset@test.dev";
const PASSWORD = "password1234";

async function signUp(email: string, password: string) {
  const res = await SELF.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:8787" },
    body: JSON.stringify({ email, password, name: "Reset" }),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  return { res, cookie };
}

async function requestReset(email: string, redirectTo = "photos:///reset-password") {
  return SELF.fetch("http://localhost/api/auth/request-password-reset", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:8787" },
    body: JSON.stringify({ email, redirectTo }),
  });
}

/** El token que better-auth guardó en `verification` para este usuario. */
async function lastResetToken(): Promise<string | undefined> {
  const row = await env.DB.prepare(
    "SELECT identifier FROM verification WHERE identifier LIKE 'reset-password:%' ORDER BY rowid DESC LIMIT 1",
  ).first<{ identifier: string }>();
  return row?.identifier.slice("reset-password:".length);
}

describe("auth password reset", () => {
  it("request-password-reset responde 200 aunque el correo no exista", async () => {
    const res = await requestReset("nadie@test.dev");
    expect(res.status).toBe(200);
    const body = await j(res);
    expect(body.status).toBe(true);
    // Anti-enumeración: no se crea token para correos inexistentes.
    const count = await env.DB.prepare(
      "SELECT count(*) AS c FROM verification WHERE identifier LIKE 'reset-password:%'",
    ).first<{ c: number }>();
    expect(count?.c).toBe(0);
  });

  it("rechaza redirectTo a origen no confiado", async () => {
    const res = await requestReset("nadie@test.dev", "https://evil.example.com/reset");
    expect(res.status).toBe(403);
  });

  it("flujo completo: solicitud → callback → reset → sign-in con nueva clave", async () => {
    await signUp(EMAIL, PASSWORD);

    const req = await requestReset(EMAIL);
    expect(req.status).toBe(200);
    const token = await lastResetToken();
    expect(token).toBeTruthy();

    // El enlace del correo pega al Worker: valida el token y redirige a la app.
    const cb = await SELF.fetch(
      `http://localhost/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent("photos:///reset-password")}`,
      { redirect: "manual" },
    );
    expect(cb.status).toBe(302);
    const location = cb.headers.get("location") ?? "";
    expect(location).toMatch(/^photos:\/\/\/reset-password\?token=.+/);

    const reset = await SELF.fetch("http://localhost/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({ token, newPassword: "nueva-clave-987" }),
    });
    expect(reset.status).toBe(200);

    const oldLogin = await SELF.fetch("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await SELF.fetch("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({ email: EMAIL, password: "nueva-clave-987" }),
    });
    expect(newLogin.status).toBe(200);
  });

  it("resetear la contraseña revoca las sesiones abiertas", async () => {
    const { cookie } = await signUp("revoke@test.dev", PASSWORD);

    const before = await SELF.fetch("http://localhost/api/auth/get-session", {
      headers: { cookie },
    });
    expect((await j(before))?.user?.email).toBe("revoke@test.dev");

    await requestReset("revoke@test.dev");
    const token = await lastResetToken();
    await SELF.fetch("http://localhost/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({ token, newPassword: "otra-clave-123" }),
    });

    const after = await SELF.fetch("http://localhost/api/auth/get-session", {
      headers: { cookie },
    });
    expect(await j(after)).toBeNull();
  });

  it("token inválido → 400 INVALID_TOKEN; callback → redirect con error", async () => {
    const res = await SELF.fetch("http://localhost/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({ token: "no-existe", newPassword: "cualquiera123" }),
    });
    expect(res.status).toBe(400);
    expect((await j(res)).code).toBe("INVALID_TOKEN");

    const cb = await SELF.fetch(
      "http://localhost/api/auth/reset-password/no-existe?callbackURL=photos%3A%2F%2F%2Freset-password",
      { redirect: "manual" },
    );
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toContain("error=INVALID_TOKEN");
  });

  it("token expirado → callback redirige con error=INVALID_TOKEN", async () => {
    await signUp("expired@test.dev", PASSWORD);
    await requestReset("expired@test.dev");
    const token = await lastResetToken();
    expect(token).toBeTruthy();

    // Ojo: drizzle mode:"timestamp" serializa a epoch SEGUNDOS (no ms).
    await env.DB.prepare("UPDATE verification SET expires_at = ? WHERE identifier = ?")
      .bind(Math.floor(Date.now() / 1000) - 60, `reset-password:${token}`)
      .run();

    const cb = await SELF.fetch(
      `http://localhost/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent("photos:///reset-password")}`,
      { redirect: "manual" },
    );
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toContain("error=INVALID_TOKEN");
  });
});

describe("reset email delivery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete env.RESEND_API_KEY;
  });

  it("con RESEND_API_KEY envía vía api.resend.com con el enlace de reset", async () => {
    // Test y worker comparten el isolate de workerd: stubar `fetch` global
    // intercepta el POST saliente a Resend sin tocar SELF.fetch (entrante).
    const sent: { url: string; body: any; auth: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        sent.push({
          url,
          body: JSON.parse(String(init?.body)),
          auth: (init?.headers as Record<string, string>)?.authorization ?? null,
        });
        return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
      }),
    );
    env.RESEND_API_KEY = "re_test_123";

    await signUp("resend@test.dev", PASSWORD);
    const res = await requestReset("resend@test.dev");
    expect(res.status).toBe(200);

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://api.resend.com/emails");
    expect(sent[0].auth).toBe("Bearer re_test_123");
    expect(sent[0].body.to).toEqual(["resend@test.dev"]);
    expect(sent[0].body.subject).toContain("contraseña");
    expect(sent[0].body.html).toContain("/reset-password/");
    // El enlace apunta al callback del API con el deep link de la app.
    expect(sent[0].body.html).toContain(encodeURIComponent("photos:///reset-password"));
  });

  it("si Resend responde error la request sigue en 200 y se registra el token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    env.RESEND_API_KEY = "re_test_123";

    await signUp("resend-fail@test.dev", PASSWORD);
    const res = await requestReset("resend-fail@test.dev");
    expect(res.status).toBe(200);
    expect(await lastResetToken()).toBeTruthy();
  });

  it("sin RESEND_API_KEY el envío cae al log y la request sigue en 200", async () => {
    await signUp("nolog@test.dev", PASSWORD);
    const res = await requestReset("nolog@test.dev");
    expect(res.status).toBe(200);
    expect(await lastResetToken()).toBeTruthy();
  });
});
