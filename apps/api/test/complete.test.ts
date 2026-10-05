import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authed, createUser, initBody, j, sha } from "./helpers";

async function init(cookie: string, body: Record<string, unknown>) {
  const res = await SELF.fetch(
    "http://localhost/v1/uploads/init",
    authed(cookie, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return res.json() as Promise<{ id: string }>;
}

async function userIdOf(cookie: string): Promise<string> {
  const res = await SELF.fetch("http://localhost/api/auth/get-session", {
    headers: { cookie },
  });
  return (await j(res)).user.id;
}

describe("uploads/complete", () => {
  it("sin objetos en R2 → 409", async () => {
    const { cookie } = await createUser();
    const { id } = await init(cookie, initBody({ sha256: sha("ee44") }));
    const res = await SELF.fetch(
      `http://localhost/v1/uploads/${id}/complete`,
      authed(cookie, { method: "POST" }),
    );
    expect(res.status).toBe(409);
    expect((await j(res)).error).toBe("object_missing");
  });

  it("con objetos y tamaños correctos → 200 ready", async () => {
    const { cookie } = await createUser();
    const body = initBody({ sha256: sha("ff55") });
    const { id } = await init(cookie, body);
    const uid = await userIdOf(cookie);
    await env.BUCKET.put(`users/${uid}/thumbs/${body.sha256}.webp`, "t".repeat(body.thumbSize));
    await env.BUCKET.put(`users/${uid}/originals/${body.sha256}.jpg`, "o".repeat(body.fileSize));
    const res = await SELF.fetch(
      `http://localhost/v1/uploads/${id}/complete`,
      authed(cookie, { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const json = await j(res);
    expect(json).toEqual({ id, status: "ready" });
    // idempotente
    const res2 = await SELF.fetch(
      `http://localhost/v1/uploads/${id}/complete`,
      authed(cookie, { method: "POST" }),
    );
    expect(res2.status).toBe(200);
  });

  it("tamaño distinto → 409 size_mismatch", async () => {
    const { cookie } = await createUser();
    const body = initBody({ sha256: sha("ab66") });
    const { id } = await init(cookie, body);
    const uid = await userIdOf(cookie);
    await env.BUCKET.put(`users/${uid}/thumbs/${body.sha256}.webp`, "t".repeat(body.thumbSize));
    await env.BUCKET.put(`users/${uid}/originals/${body.sha256}.jpg`, "short");
    const res = await SELF.fetch(
      `http://localhost/v1/uploads/${id}/complete`,
      authed(cookie, { method: "POST" }),
    );
    expect(res.status).toBe(409);
    expect((await j(res)).error).toBe("size_mismatch");
  });

  it("registro de otro usuario → 404", async () => {
    const a = await createUser();
    const b = await createUser();
    const { id } = await init(a.cookie, initBody({ sha256: sha("cd77") }));
    const res = await SELF.fetch(
      `http://localhost/v1/uploads/${id}/complete`,
      authed(b.cookie, { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });
});
