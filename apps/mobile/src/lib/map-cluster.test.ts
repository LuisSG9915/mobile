import { describe, expect, it } from "vitest";
import { clusterMarkers } from "./map-cluster";

const m = (id: string, x: number, y: number) => ({ item: { id }, screenX: x, screenY: y });

describe("clusterMarkers", () => {
  it("deja pines lejanos como individuales", () => {
    const out = clusterMarkers([m("a", 10, 10), m("b", 300, 300)], 56);
    expect(out).toHaveLength(2);
    expect(out.every((c) => c.count === 1)).toBe(true);
  });

  it("agrupa los de la misma celda y usa el centroide", () => {
    const out = clusterMarkers([m("a", 10, 10), m("b", 30, 30)], 56);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ count: 2, screenX: 20, screenY: 20 });
  });

  it("el pin preferido es la portada de su grupo", () => {
    const out = clusterMarkers([m("a", 10, 10), m("b", 30, 30)], 56, "b");
    expect(out[0].item.id).toBe("b");
  });
});
