import { describe, expect, it } from "vitest";
import {
  clampPanTranslation,
  computeBackdropOpacity,
  computeDoubleTapZoomTarget,
  shouldDismissOnVerticalSwipe,
  shouldLoadFullResolution,
} from "./viewer-physics";

const sampleDims = {
  viewportWidth: 400,
  viewportHeight: 800,
  imageWidth: 4000,
  imageHeight: 3000,
};

describe("viewer-physics", () => {
  it("restringe el paneo a (0,0) cuando la escala es 1x", () => {
    expect(clampPanTranslation(120, -80, 1, sampleDims)).toEqual({ x: 0, y: 0 });
  });

  it("limita translateX y translateY según el borde real de la imagen ampliada", () => {
    const clamped = clampPanTranslation(350, 100, 2, sampleDims);
    expect(clamped.x).toBe(200);
    expect(clamped.y).toBe(0);
  });

  it("hace zoom focal hacia la esquina tocada en el primer doble toque y vuelve a 1x en el segundo", () => {
    const zoomIn = computeDoubleTapZoomTarget(50, 400, 1, sampleDims, 2.5);
    expect(zoomIn.scale).toBe(2.5);
    expect(zoomIn.x).toBeGreaterThan(0);

    const zoomOut = computeDoubleTapZoomTarget(50, 400, zoomIn.scale, sampleDims, 2.5);
    expect(zoomOut).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("solo permite swipe-to-dismiss cuando la imagen no tiene zoom activo", () => {
    expect(shouldDismissOnVerticalSwipe(140, 200, 1)).toBe(true);
    expect(shouldDismissOnVerticalSwipe(50, 1000, 1)).toBe(true);
    expect(shouldDismissOnVerticalSwipe(200, 1200, 2.2)).toBe(false);
  });

  it("activa la carga de resolución original únicamente a partir de 1.5x", () => {
    expect(shouldLoadFullResolution(1.2)).toBe(false);
    expect(shouldLoadFullResolution(1.5)).toBe(true);
    expect(shouldLoadFullResolution(2.5)).toBe(true);
    expect(computeBackdropOpacity(200, 800)).toBeLessThan(1);
  });
});
