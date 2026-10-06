import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { initBody, j, sha } from "./helpers";

const WEB = "http://localhost:8081"; // en la allowlist de WEB_ORIGINS del test env

let counter = 0;

// Sign-up con Origin web: el cliente del navegador autentica con Bearer
// (set-auth-token), no con cookies.
async function signUpWeb(): Promise<{ token: string; userId: string }> {
  counter += 1;
  const res = await SELF.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: WEB },
    body: JSON.stringify({
      email: `webflow${counter}@test.dev`,
      password: "password1234",
      name: `Web ${counter}`,
    }),
  });
  if (res.status !== 200) {
    throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  }
  const token = res.headers.get("set-auth-token");
  if (!token) {
    throw new Error("sign-up sin set-auth-token");
  }
  const body = (await res.json()) as { user: { id: string } };
  return { token, userId: body.user.id };
}

function bearer(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { authorization: `Bearer ${token}`, origin: WEB, ...(init.headers ?? {}) },
  };
}

async function initWeb(token: string, body: Record<string, unknown>) {
  return SELF.fetch(
    "http://localhost/v1/uploads/init",
    bearer(token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("web flow (Bearer + CORS)", () => {
  it("init con Bearer y origen permitido → 201 con access-control-allow-origin", async () => {
    const { token } = await signUpWeb();
    const res = await initWeb(token, initBody({ sha256: sha("ee01") }));
    expect(res.status).toBe(201);
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
    expect((await j(res)).status).toBe("upload");
  });

  it("stats sin auth con origen permitido → 401 con access-control-allow-origin", async () => {
    const res = await SELF.fetch("http://localhost/v1/stats", { headers: { origin: WEB } });
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
  });

  it("complete con miniatura que no es WebP → 409 mime_mismatch", async () => {
    const { token, userId } = await signUpWeb();
    const body = initBody({ sha256: sha("ee02") });
    const { id } = await j(await initWeb(token, body));
    await env.BUCKET.put(`users/${userId}/thumbs/${body.sha256}.webp`, "t".repeat(body.thumbSize), {
      httpMetadata: { contentType: "image/png" },
    });
    await env.BUCKET.put(
      `users/${userId}/originals/${body.sha256}.jpg`,
      "o".repeat(body.fileSize),
      { httpMetadata: { contentType: "image/jpeg" } },
    );
    const res = await SELF.fetch(
      `http://localhost/v1/uploads/${id}/complete`,
      bearer(token, { method: "POST" }),
    );
    expect(res.status).toBe(409);
    const json = await j(res);
    expect(json.error).toBe("mime_mismatch");
    expect(json.message).toBe("La miniatura subida no es WebP.");
  });

  it("complete con original de otro MIME que el declarado → 409 mime_mismatch", async () => {
    const { token, userId } = await signUpWeb();
    const body = initBody({ sha256: sha("ee03") }); // init declara image/jpeg
    const { id } = await j(await initWeb(token, body));
    await env.BUCKET.put(`users/${userId}/thumbs/${body.sha256}.webp`, "t".repeat(body.thumbSize), {
      httpMetadata: { contentType: "image/webp" },
    });
    await env.BUCKET.put(
      `users/${userId}/originals/${body.sha256}.jpg`,
      "o".repeat(body.fileSize),
      { httpMetadata: { contentType: "image/png" } },
    );
    const res = await SELF.fetch(
      `http://localhost/v1/uploads/${id}/complete`,
      bearer(token, { method: "POST" }),
    );
    expect(res.status).toBe(409);
    const json = await j(res);
    expect(json.error).toBe("mime_mismatch");
    expect(json.message).toBe("El tipo de archivo subido no coincide con el declarado.");
  });

  it("timeline con Bearer → 200", async () => {
    const { token } = await signUpWeb();
    const res = await SELF.fetch("http://localhost/v1/timeline", bearer(token));
    expect(res.status).toBe(200);
    expect(Array.isArray((await j(res)).items)).toBe(true);
  });

  it("media/:id con Bearer tras init + put + complete → 200", async () => {
    const { token, userId } = await signUpWeb();
    const body = initBody({ sha256: sha("ee04") });
    const { id } = await j(await initWeb(token, body));
    await env.BUCKET.put(`users/${userId}/thumbs/${body.sha256}.webp`, "t".repeat(body.thumbSize), {
      httpMetadata: { contentType: "image/webp" },
    });
    await env.BUCKET.put(
      `users/${userId}/originals/${body.sha256}.jpg`,
      "o".repeat(body.fileSize),
      { httpMetadata: { contentType: "image/jpeg" } },
    );
    const complete = await SELF.fetch(
      `http://localhost/v1/uploads/${id}/complete`,
      bearer(token, { method: "POST" }),
    );
    expect(complete.status).toBe(200);
    expect(await j(complete)).toEqual({ id, status: "ready" });

    const res = await SELF.fetch(`http://localhost/v1/media/${id}`, bearer(token));
    expect(res.status).toBe(200);
    const detail = await j(res);
    expect(detail.id).toBe(id);
    expect(detail.originalUrl).toContain("X-Amz-Signature");
  });
});
