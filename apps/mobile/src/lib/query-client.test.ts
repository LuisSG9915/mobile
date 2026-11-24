import { describe, expect, it } from "vitest";
import {
  clearPersistedQueryCache,
  createAppQueryClient,
  hydrateQueryClientFromDisk,
  type OfflineStorageAdapter,
  setupQueryClientPersistence,
} from "./query-client";

function createMemoryAdapter(): OfflineStorageAdapter & { raw: string | null } {
  return {
    raw: null,
    async read() {
      return this.raw;
    },
    async write(payload: string) {
      this.raw = payload;
    },
    async clear() {
      this.raw = null;
    },
  };
}

describe("query-client offline persistence", () => {
  it("persiste únicamente las queries permitidas y las hidrata en un nuevo cliente", async () => {
    const adapter = createMemoryAdapter();
    const client1 = createAppQueryClient();
    const stop = setupQueryClientPersistence(client1, adapter, 10);

    client1.setQueryData(["timeline", "page-1"], { items: [{ id: "m1" }] });
    client1.setQueryData(["ephemeral-auth-token"], { secret: "nope" });

    await new Promise((r) => setTimeout(r, 30));
    stop();

    expect(adapter.raw).toBeTruthy();

    const client2 = createAppQueryClient();
    const hydrated = await hydrateQueryClientFromDisk(client2, adapter);

    expect(hydrated).toBe(true);
    expect(client2.getQueryData(["timeline", "page-1"])).toEqual({
      items: [{ id: "m1" }],
    });
    expect(client2.getQueryData(["ephemeral-auth-token"])).toBeUndefined();

    await clearPersistedQueryCache(client2, adapter);
    expect(adapter.raw).toBeNull();
  });
});
