import { describe, expect, it } from "vitest";
import { computeSwipeDismissFrame, shouldTriggerSwipeDismiss } from "./viewer-physics";

describe("computeSwipeDismissFrame", () => {
  it("amortigua el arrastre hacia arriba y no despega la tarjeta", () => {
    const frame = computeSwipeDismissFrame(100, -80, 800);
    expect(frame.tx).toBe(25);
    expect(frame.ty).toBe(-20);
    expect(frame.scale).toBe(1);
    expect(frame.borderRadius).toBe(0);
    expect(frame.backdropOpacity).toBe(1);
  });

  it("aplica física 2D al arrastrar hacia abajo", () => {
    const frame = computeSwipeDismissFrame(100, 180, 800);
    expect(frame.tx).toBe(65);
    expect(frame.ty).toBe(180);
    expect(frame.scale).toBeCloseTo(0.875);
    expect(frame.scale).toBeGreaterThanOrEqual(0.72);
    expect(frame.scale).toBeLessThan(1);
    expect(frame.borderRadius).toBeCloseTo(12);
    expect(frame.borderRadius).toBeGreaterThan(0);
    expect(frame.borderRadius).toBeLessThanOrEqual(24);
    expect(frame.backdropOpacity).toBeCloseTo(0.575);
    expect(frame.backdropOpacity).toBeLessThan(1);
  });

  it("limita la escala y el redondeo al llegar al fondo", () => {
    const frame = computeSwipeDismissFrame(0, 1000, 800);
    expect(frame.scale).toBe(0.75);
    expect(frame.borderRadius).toBe(24);
    expect(frame.backdropOpacity).toBeCloseTo(0.15);
  });
});

describe("shouldTriggerSwipeDismiss", () => {
  it("cierra por distancia aunque la velocidad sea baja", () => {
    expect(shouldTriggerSwipeDismiss(120, 50)).toBe(true);
  });

  it("cierra por un flick rápido con recorrido corto", () => {
    expect(shouldTriggerSwipeDismiss(60, 750)).toBe(true);
  });

  it("no cierra en un movimiento corto y lento", () => {
    expect(shouldTriggerSwipeDismiss(40, 100)).toBe(false);
  });
});
