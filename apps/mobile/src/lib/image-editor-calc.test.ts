import { describe, expect, it } from "vitest";
import {
  buildColorMatrix20,
  computeAspectCropRect,
  computeStraightenSafetyScale,
  createEditHistory,
  DEFAULT_EDIT_RECIPE,
  hasColorAdjustments,
  isRecipeModified,
  pushEditRecipe,
  redoEditRecipe,
  resolvePixelCropRect,
  undoEditRecipe,
} from "./image-editor-calc";

describe("image-editor-calc", () => {
  it("calcula recorte 1:1 centrado sobre una foto horizontal 4000x3000", () => {
    const crop = computeAspectCropRect(4000, 3000, "1:1");
    expect(crop.width).toBeCloseTo(0.75, 4);
    expect(crop.height).toBe(1);
    expect(crop.x).toBeCloseTo(0.125, 4);
  });

  it("aplica zoom de seguridad al enderezar el horizonte para evitar bordes negros", () => {
    const scale0 = computeStraightenSafetyScale(4000, 3000, 0);
    const scale10 = computeStraightenSafetyScale(4000, 3000, 10);
    expect(scale0).toBe(1);
    expect(scale10).toBeGreaterThan(1.15);

    const pixelCrop = resolvePixelCropRect(4000, 3000, 0, { x: 0, y: 0, width: 1, height: 1 }, 10);
    expect(pixelCrop.originX).toBeGreaterThan(0);
    expect(pixelCrop.width).toBeLessThan(4000);
  });

  it("gestiona la pila Undo / Redo de forma determinista", () => {
    let state = createEditHistory();
    expect(isRecipeModified(state.present)).toBe(false);

    state = pushEditRecipe(state, { ...DEFAULT_EDIT_RECIPE, rotation: 90 });
    expect(isRecipeModified(state.present)).toBe(true);

    state = undoEditRecipe(state);
    expect(state.present.rotation).toBe(0);

    state = redoEditRecipe(state);
    expect(state.present.rotation).toBe(90);
  });
});

describe("buildColorMatrix20", () => {
  it("genera la matriz identidad 4x5 cuando no hay ajustes activos", () => {
    expect(hasColorAdjustments(DEFAULT_EDIT_RECIPE)).toBe(false);
    const m = buildColorMatrix20(DEFAULT_EDIT_RECIPE);
    expect(m).toHaveLength(20);
    expect(m[0]).toBeCloseTo(1, 4);
    expect(m[6]).toBeCloseTo(1, 4);
    expect(m[12]).toBeCloseTo(1, 4);
    expect(m[18]).toBe(1);
    expect(m[4]).toBeCloseTo(0, 4);
    expect(m[9]).toBeCloseTo(0, 4);
    expect(m[14]).toBeCloseTo(0, 4);
  });

  it("iguala los pesos RGB por fila cuando se aplica el preset mono", () => {
    const monoRecipe = { ...DEFAULT_EDIT_RECIPE, filterPreset: "mono" as const };
    expect(hasColorAdjustments(monoRecipe)).toBe(true);
    const m = buildColorMatrix20(monoRecipe);
    expect(m[0]).toBeCloseTo(m[5]!, 5);
    expect(m[0]).toBeCloseTo(m[10]!, 5);
    expect(m[1]).toBeCloseTo(m[6]!, 5);
    expect(m[2]).toBeCloseTo(m[12]!, 5);
  });

  it("desplaza tR en positivo y tB en negativo al aumentar la calidez", () => {
    const warmRecipe = {
      ...DEFAULT_EDIT_RECIPE,
      adjustments: { ...DEFAULT_EDIT_RECIPE.adjustments, warmth: 0.5 },
    };
    const m = buildColorMatrix20(warmRecipe);
    expect(m[4]).toBeGreaterThan(0);
    expect(m[14]).toBeLessThan(0);
  });
});
