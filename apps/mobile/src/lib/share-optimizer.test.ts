import { describe, expect, it } from "vitest";
import { computeShareTargetDimensions, planVideoOptimization } from "./share-optimizer-calc";

describe("share-optimizer-calc", () => {
  it("escala una foto 4000x3000 a 1600x1200 para el perfil messaging", () => {
    const res = computeShareTargetDimensions(4000, 3000, "messaging");
    expect(res).toEqual({ width: 1600, height: 1200, needsResize: true, needsReencode: true });
  });

  it("hace passthrough en 0ms si el video ya cumple tamaño y bitrate del perfil", () => {
    const plan = planVideoOptimization(1280, 720, 10_000, 2_000_000, "messaging");
    expect(plan.passthrough).toBe(true);
  });

  it("reduce resolución a múltiplos pares y ajusta bitrate en videos 4K pesados", () => {
    const plan = planVideoOptimization(3840, 2160, 30_000, 85_000_000, "messaging");
    expect(plan.passthrough).toBe(false);
    expect(plan.targetWidth).toBe(1600);
    expect(plan.targetHeight % 2).toBe(0);
    expect(plan.estimatedOutputBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
  });
});
