import { describe, expect, it, vi } from "vitest";
import {
  invalidateMediaLifecycleQueries,
  MEDIA_LIFECYCLE_QUERY_KEYS,
  type queryClient,
} from "./query-client";

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
});
