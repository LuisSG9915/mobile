import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Estado `needs_email_verification` (403 del servidor): debe persistir en kv y
 * limpiarse solo cuando el respaldo vuelve a funcionar. db.web.ts usa
 * localStorage con prefijo `photos.kv.`.
 */
vi.mock("../web/queue-store", () => ({
  getActiveContext: () => ({ userId: "u1", epoch: 1 }),
}));

describe("needsEmailVerification (web)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("arranca apagado y persiste el aviso tras el 403", async () => {
    vi.resetModules();
    // @ts-expect-error -- extensión explícita para resolver el módulo web
    const db = await import("./db.web.ts");
    expect(db.needsEmailVerification()).toBe(false);

    db.setNeedsEmailVerification(true);
    expect(db.needsEmailVerification()).toBe(true);
    expect(localStorage.getItem("photos.kv.backup.needs_email_verification")).toBe("1");

    db.setNeedsEmailVerification(false);
    expect(db.needsEmailVerification()).toBe(false);
  });

  it("reanudar el respaldo no borra el aviso por sí solo (lo decide el 403)", async () => {
    vi.resetModules();
    // @ts-expect-error -- extensión explícita para resolver el módulo web
    const db = await import("./db.web.ts");
    db.setNeedsEmailVerification(true);
    db.setBackupPaused(false);
    expect(db.needsEmailVerification()).toBe(true);
  });
});
