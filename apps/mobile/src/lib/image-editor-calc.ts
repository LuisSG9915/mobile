export type AspectRatioOption = "original" | "1:1" | "4:3" | "16:9" | "9:16";

/**
 * Devuelve el valor numérico (ancho / alto) de una relación de aspecto,
 * o null si debe mantenerse la original.
 */
export function aspectRatioValue(ratio: AspectRatioOption): number | null {
  switch (ratio) {
    case "original":
      return null;
    case "1:1":
      return 1;
    case "4:3":
      return 4 / 3;
    case "16:9":
      return 16 / 9;
    case "9:16":
      return 9 / 16;
  }
}

// ---------- Bloque 5: receta no destructiva ----------

export type QuarterTurn = 0 | 90 | 180 | 270;
export type AspectPreset = "free" | "original" | "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
export type FilterPresetId = "none" | "vivid" | "warm" | "cool" | "mono" | "dramatic";

export interface NormalizedCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ColorAdjustments {
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
}
export interface PhotoEditRecipe {
  rotation: QuarterTurn;
  straightenDeg: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  aspectPreset: AspectPreset;
  crop: NormalizedCropRect;
  adjustments: ColorAdjustments;
  filterPreset: FilterPresetId;
}
export interface PixelCropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export const DEFAULT_EDIT_RECIPE: PhotoEditRecipe = {
  rotation: 0,
  straightenDeg: 0,
  flipHorizontal: false,
  flipVertical: false,
  aspectPreset: "original",
  crop: { x: 0, y: 0, width: 1, height: 1 },
  adjustments: { exposure: 0, brightness: 0, contrast: 0, saturation: 0, warmth: 0 },
  filterPreset: "none",
};

const PRESET_ADJUSTMENTS: Record<FilterPresetId, Partial<ColorAdjustments>> = {
  none: {},
  vivid: { contrast: 0.18, saturation: 0.32, brightness: 0.04 },
  warm: { warmth: 0.35, saturation: 0.12, brightness: 0.03 },
  cool: { warmth: -0.35, contrast: 0.1, saturation: -0.05 },
  mono: { saturation: -1, contrast: 0.22 },
  dramatic: { contrast: 0.38, saturation: -0.2, exposure: -0.08 },
};

export function isRecipeModified(recipe: PhotoEditRecipe): boolean {
  const c = recipe.crop;
  const a = recipe.adjustments;
  return (
    recipe.rotation !== 0 ||
    Math.abs(recipe.straightenDeg) > 0.01 ||
    recipe.flipHorizontal ||
    recipe.flipVertical ||
    recipe.filterPreset !== "none" ||
    Math.abs(c.x) > 0.001 ||
    Math.abs(c.y) > 0.001 ||
    Math.abs(c.width - 1) > 0.001 ||
    Math.abs(c.height - 1) > 0.001 ||
    Math.abs(a.exposure) > 0.001 ||
    Math.abs(a.brightness) > 0.001 ||
    Math.abs(a.contrast) > 0.001 ||
    Math.abs(a.saturation) > 0.001 ||
    Math.abs(a.warmth) > 0.001
  );
}

export function rotateQuarterTurn(
  current: QuarterTurn,
  direction: "cw" | "ccw" = "cw",
): QuarterTurn {
  const delta = direction === "cw" ? 90 : 270;
  return ((current + delta) % 360) as QuarterTurn;
}

export function getRotatedDimensions(
  width: number,
  height: number,
  rotation: QuarterTurn,
): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return rotation === 90 || rotation === 270 ? { width: h, height: w } : { width: w, height: h };
}

export function computeAspectCropRect(
  sourceWidth: number,
  sourceHeight: number,
  preset: AspectPreset,
): NormalizedCropRect {
  if (preset === "free" || preset === "original") return { x: 0, y: 0, width: 1, height: 1 };
  const ratioMap: Record<Exclude<AspectPreset, "free" | "original">, number> = {
    "1:1": 1,
    "4:3": 4 / 3,
    "3:4": 3 / 4,
    "16:9": 16 / 9,
    "9:16": 9 / 16,
  };
  const targetRatio = ratioMap[preset];
  const currentRatio = Math.max(1, sourceWidth) / Math.max(1, sourceHeight);
  if (Math.abs(currentRatio - targetRatio) < 0.001) return { x: 0, y: 0, width: 1, height: 1 };
  if (currentRatio > targetRatio) {
    const normWidth = targetRatio / currentRatio;
    return { x: (1 - normWidth) / 2, y: 0, width: normWidth, height: 1 };
  }
  const normHeight = currentRatio / targetRatio;
  return { x: 0, y: (1 - normHeight) / 2, width: 1, height: normHeight };
}

export function computeStraightenSafetyScale(
  width: number,
  height: number,
  straightenDeg: number,
): number {
  const clampedDeg = Math.max(-45, Math.min(45, straightenDeg));
  const rad = (Math.abs(clampedDeg) * Math.PI) / 180;
  if (rad < 0.0001) return 1;
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const ratio = w >= h ? w / h : h / w;
  return Math.cos(rad) + ratio * Math.sin(rad);
}

export function resolvePixelCropRect(
  sourceWidth: number,
  sourceHeight: number,
  rotation: QuarterTurn,
  crop: NormalizedCropRect,
  straightenDeg = 0,
): PixelCropRect {
  const rotated = getRotatedDimensions(sourceWidth, sourceHeight, rotation);
  const safetyScale = computeStraightenSafetyScale(rotated.width, rotated.height, straightenDeg);
  const effectiveW = crop.width / safetyScale;
  const effectiveH = crop.height / safetyScale;
  const effectiveX = crop.x + (crop.width - effectiveW) / 2;
  const effectiveY = crop.y + (crop.height - effectiveH) / 2;
  const clampedX = Math.max(0, Math.min(0.99, effectiveX));
  const clampedY = Math.max(0, Math.min(0.99, effectiveY));
  const clampedW = Math.max(0.01, Math.min(1 - clampedX, effectiveW));
  const clampedH = Math.max(0.01, Math.min(1 - clampedY, effectiveH));
  const originX = Math.floor(clampedX * rotated.width);
  const originY = Math.floor(clampedY * rotated.height);
  const width = Math.max(
    1,
    Math.min(rotated.width - originX, Math.round(clampedW * rotated.width)),
  );
  const height = Math.max(
    1,
    Math.min(rotated.height - originY, Math.round(clampedH * rotated.height)),
  );
  return { originX, originY, width, height };
}

export function buildCssFilterString(recipe: PhotoEditRecipe): string {
  const preset = PRESET_ADJUSTMENTS[recipe.filterPreset] ?? {};
  const a = recipe.adjustments;
  const brightness = Math.max(
    0.2,
    1 +
      (a.brightness + (preset.brightness ?? 0)) * 0.5 +
      (a.exposure + (preset.exposure ?? 0)) * 0.6,
  );
  const contrast = Math.max(0.2, 1 + (a.contrast + (preset.contrast ?? 0)) * 0.65);
  const saturation = Math.max(0, 1 + (a.saturation + (preset.saturation ?? 0)));
  const warmth = a.warmth + (preset.warmth ?? 0);
  const parts = [
    `brightness(${brightness.toFixed(3)})`,
    `contrast(${contrast.toFixed(3)})`,
    `saturate(${saturation.toFixed(3)})`,
  ];
  if (warmth > 0.01) parts.push(`sepia(${(warmth * 0.35).toFixed(3)})`);
  else if (warmth < -0.01) parts.push(`hue-rotate(${Math.round(warmth * 25)}deg)`);
  return parts.join(" ");
}

export interface EditHistoryState {
  past: PhotoEditRecipe[];
  present: PhotoEditRecipe;
  future: PhotoEditRecipe[];
}

export function createEditHistory(
  initial: PhotoEditRecipe = DEFAULT_EDIT_RECIPE,
): EditHistoryState {
  return { past: [], present: initial, future: [] };
}

export function pushEditRecipe(
  history: EditHistoryState,
  next: PhotoEditRecipe,
  maxDepth = 30,
): EditHistoryState {
  const nextPast = [...history.past, history.present].slice(-maxDepth);
  return { past: nextPast, present: next, future: [] };
}

export function undoEditRecipe(history: EditHistoryState): EditHistoryState {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1]!;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoEditRecipe(history: EditHistoryState): EditHistoryState {
  if (history.future.length === 0) return history;
  const next = history.future[0]!;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

// ---------- Bloque 6: matriz de color 4x5 ----------

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

export function hasColorAdjustments(recipe: PhotoEditRecipe): boolean {
  const a = recipe.adjustments;
  return (
    recipe.filterPreset !== "none" ||
    Math.abs(a.exposure) > 0.001 ||
    Math.abs(a.brightness) > 0.001 ||
    Math.abs(a.contrast) > 0.001 ||
    Math.abs(a.saturation) > 0.001 ||
    Math.abs(a.warmth) > 0.001
  );
}

export function buildColorMatrix20(recipe: PhotoEditRecipe): number[] {
  const preset = PRESET_ADJUSTMENTS[recipe.filterPreset] ?? {};
  const a = recipe.adjustments;

  const exp = Math.max(-1, Math.min(1, a.exposure + (preset.exposure ?? 0)));
  const bri = Math.max(-1, Math.min(1, a.brightness + (preset.brightness ?? 0)));
  const con = Math.max(-1, Math.min(1, a.contrast + (preset.contrast ?? 0)));
  const sat = Math.max(-1, Math.min(1, a.saturation + (preset.saturation ?? 0)));
  const war = Math.max(-1, Math.min(1, a.warmth + (preset.warmth ?? 0)));

  const exposureGain = 2 ** (exp * 0.75);
  const contrastGain = Math.max(0.2, 1 + con * 0.65);
  const scale = exposureGain * contrastGain;

  const s = Math.max(0, 1 + sat);
  const invS = 1 - s;

  const r0 = (invS * LUMA_R + s) * scale;
  const r1 = invS * LUMA_G * scale;
  const r2 = invS * LUMA_B * scale;

  const g0 = invS * LUMA_R * scale;
  const g1 = (invS * LUMA_G + s) * scale;
  const g2 = invS * LUMA_B * scale;

  const b0 = invS * LUMA_R * scale;
  const b1 = invS * LUMA_G * scale;
  const b2 = (invS * LUMA_B + s) * scale;

  const baseOffset = 128 * (1 - contrastGain) + bri * 85;
  const tR = baseOffset + war * 22;
  const tG = baseOffset + war * 4;
  const tB = baseOffset - war * 22;

  return [r0, r1, r2, 0, tR, g0, g1, g2, 0, tG, b0, b1, b2, 0, tB, 0, 0, 0, 1, 0];
}
