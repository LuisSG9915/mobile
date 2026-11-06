import { describe, expect, it, vi } from "vitest";
import {
  invalidateMediaLifecycleQueries,
  MEDIA_LIFECYCLE_QUERY_KEYS,
  queryClient,
} from "./query-client";

/**
 * `api/client` arrastra auth/Expo/React Native (Flow) y este test solo necesita
 * la identidad de `ApiError` para el retry. Se mockea para no montar ese grafo.
 */
vi.mock("../api/client", () => {
  class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return { ApiError };
});

describe("query-client: invalidateMediaLifecycleQueries", () => {
  it("invalida simultáneamente las 9 claves de ciclo de vida", async () => {
    const invalidated: string[][] = [];
    const mockQc = {
      invalidateQueries: vi.fn(async ({ queryKey }: { queryKey: string[] }) => {
        invalidated.push(queryKey);
      }),
    } as unknown as typeof queryClient;

    await invalidateMediaLifecycleQueries(mockQc);

    expect(invalidated).toEqual([
      ["storage"],
      ["user-storage"],
      ["timeline"],
      ["timeline-months"],
      ["trash"],
      ["albums"],
      ["search"],
      ["locations"],
      ["memories"],
    ]);
  });

  it("exporta exactamente las 9 claves requeridas", () => {
    expect(MEDIA_LIFECYCLE_QUERY_KEYS).toEqual([
      ["storage"],
      ["user-storage"],
      ["timeline"],
      ["timeline-months"],
      ["trash"],
      ["albums"],
      ["search"],
      ["locations"],
      ["memories"],
    ]);
  });

  it("rechaza de inmediato reintentos ante errores 401, 403 y 404", () => {
    const retryFn = queryClient.getDefaultOptions().queries?.retry as
      | ((count: number, err: unknown) => boolean)
      | undefined;
    expect(typeof retryFn).toBe("function");
    if (!retryFn) return;

    expect(retryFn(0, { status: 401 })).toBe(false);
    expect(retryFn(0, { status: 403 })).toBe(false);
    expect(retryFn(0, { status: 404 })).toBe(false);
    expect(retryFn(0, { status: 500 })).toBe(true);
    expect(retryFn(1, { status: 500 })).toBe(true);
    expect(retryFn(2, { status: 500 })).toBe(false);
    expect(retryFn(0, new Error("network down"))).toBe(true);
  });
});
