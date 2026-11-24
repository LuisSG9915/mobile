import type { MediaManifestItem } from "@photos/shared";
import { describe, expect, it, vi } from "vitest";
import type { RestoreItem } from "./plan";
import { type RestoreCounts, type RestoreDeps, type RestoreStore, runRestore } from "./processor";

function memStore(): RestoreStore & { items: Map<string, RestoreItem> } {
  const items = new Map<string, RestoreItem>();
  return {
    items,
    enqueue(list, state = "queued") {
      for (const m of list) {
        items.set(m.id, {
          remoteId: m.id,
          sha256: m.sha256,
          fileSize: m.fileSize,
          ext: m.ext,
          mediaType: m.mediaType,
          takenAt: m.takenAt,
          state,
          attempts: 0,
          mismatches: 0,
          lastError: null,
        });
      }
    },
    next: () => [...items.values()].find((i) => i.state === "queued") ?? null,
    update(id, patch) {
      const cur = items.get(id);
      if (cur) items.set(id, { ...cur, ...patch });
    },
    counts() {
      const c = {
        queued: 0,
        downloading: 0,
        verifying: 0,
        done: 0,
        skipped_local: 0,
        failed: 0,
        corrupt: 0,
      } as RestoreCounts;
      for (const i of items.values()) c[i.state]++;
      return c;
    },
    retryFailed() {},
    clear: () => items.clear(),
  };
}

const m = (id: string, sha = id): MediaManifestItem => ({
  id,
  sha256: sha,
  fileSize: 10,
  ext: "jpg",
  mediaType: "photo",
  takenAt: 1,
});

function deps(over: Partial<RestoreDeps> = {}): RestoreDeps {
  return {
    getDownload: async (id) => ({ url: `https://x/${id}`, filename: `${id}.jpg` }),
    download: async (_u, name) => `file:///cache/${name}`,
    sha256: async (uri) => uri.match(/restore-(.+?)\./)?.[1] ?? "",
    saveToLibrary: async () => {},
    deleteFile: async () => {},
    freeBytes: async () => 10 ** 12,
    networkOk: async () => true,
    ...over,
  };
}

describe("runRestore", () => {
  it("descarga, verifica y guarda; borra el temporal", async () => {
    const store = memStore();
    store.enqueue([m("aaaaaaaaaaaaaaaa1")]);
    const save = vi.fn(async (_uri: string, _item: unknown) => {});
    const del = vi.fn(async () => {});
    const out = await runRestore(
      store,
      deps({ saveToLibrary: save, deleteFile: del, sha256: async () => "aaaaaaaaaaaaaaaa1" }),
    );
    expect(out).toBe("done");
    expect(store.counts().done).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toEqual({
      mediaType: "photo",
      takenAt: 1,
      sha256: "aaaaaaaaaaaaaaaa1",
      remoteId: "aaaaaaaaaaaaaaaa1",
    });
  });

  it("hash distinto: un reintento y luego corrupt, sin guardar", async () => {
    const store = memStore();
    store.enqueue([m("s1")]);
    const save = vi.fn(async () => {});
    const out = await runRestore(store, deps({ saveToLibrary: save, sha256: async () => "otro" }));
    expect(out).toBe("done");
    expect(store.counts().corrupt).toBe(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("error de descarga: reintenta 3 veces y falla", async () => {
    const store = memStore();
    store.enqueue([m("s1")]);
    const get = vi.fn(async () => {
      throw new Error("boom");
    });
    await runRestore(store, deps({ getDownload: get }));
    expect(get).toHaveBeenCalledTimes(3);
    expect(store.counts().failed).toBe(1);
    expect(store.items.get("s1")?.lastError).toBe("boom");
  });

  it("sin espacio: pausa por disco sin gastar intentos", async () => {
    const store = memStore();
    store.enqueue([m("s1")]);
    const out = await runRestore(store, deps({ freeBytes: async () => 0 }));
    expect(out).toBe("disk");
    expect(store.items.get("s1")).toMatchObject({ state: "queued", attempts: 0 });
  });

  it("sin red permitida: pausa por red", async () => {
    const store = memStore();
    store.enqueue([m("s1")]);
    expect(await runRestore(store, deps({ networkOk: async () => false }))).toBe("network");
    expect(store.counts().queued).toBe(1);
  });

  it("shouldStop corta tras el ítem en curso y deja el resto en cola", async () => {
    const store = memStore();
    store.enqueue([m("a1"), m("b1")]);
    let n = 0;
    const out = await runRestore(
      store,
      deps({ sha256: async (u) => u.match(/restore-(.+?)\./)?.[1] ?? "" }),
      () => n++ >= 1,
    );
    expect(out).toBe("stopped");
    expect(store.counts().done).toBe(1);
    expect(store.counts().queued).toBe(1);
  });
});
