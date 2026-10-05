import { SELF } from "cloudflare:test";

export const j = async (res: Response): Promise<any> => res.json();

let counter = 0;

export async function createUser(): Promise<{ cookie: string; userId: string }> {
  counter += 1;
  const email = `user${counter}@test.dev`;
  const res = await SELF.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:8787" },
    body: JSON.stringify({ email, password: "password1234", name: `User ${counter}` }),
  });
  if (res.status !== 200) {
    throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  }
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0];
  const body = (await res.json()) as { user: { id: string } };
  return { cookie, userId: body.user.id };
}

export function authed(cookie: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { cookie, ...(init.headers ?? {}) },
  };
}

export const sha = (seed: string) => seed.padEnd(64, "0").slice(0, 64);

export function initBody(over: Record<string, unknown> = {}) {
  return {
    sha256: sha(`a${counter}${Math.random().toString(16).slice(2, 10)}`),
    mediaType: "photo",
    mimeType: "image/jpeg",
    ext: "jpg",
    fileSize: 1_000_000,
    thumbSize: 8_000,
    takenAt: Date.now(),
    width: 4032,
    height: 3024,
    thumbhash: "AQAAAA==",
    ...over,
  };
}
