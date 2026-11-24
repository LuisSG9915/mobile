export type SharePreset = "stories" | "facebook" | "whatsapp_hd" | "original";

export type OptimizePhotoOptions = {
  uri: string;
  width: number;
  height: number;
  preset: SharePreset;
};

export type OptimizedMediaResult = {
  uri: string;
  width: number;
  height: number;
  filename: string;
};

export type CropArea = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

export type TargetDimensions = {
  width: number;
  height: number;
};

export type PresetConfig = {
  compressQuality: number;
  filenamePrefix: string;
  maxDimension?: number;
  targetRatio?: number;
};

/**
 * Devuelve la configuración de compresión y dimensiones de cada preset.
 */
export function getPresetConfig(preset: SharePreset): PresetConfig {
  switch (preset) {
    case "stories":
      return {
        compressQuality: 0.9,
        filenamePrefix: "historia_1080x1920",
        targetRatio: 9 / 16,
      };
    case "facebook":
      return {
        compressQuality: 0.89,
        filenamePrefix: "facebook_2048px",
        maxDimension: 2048,
      };
    case "whatsapp_hd":
      return {
        compressQuality: 0.85,
        filenamePrefix: "whatsapp_hd",
        maxDimension: 3000,
      };
    case "original":
      return {
        compressQuality: 1.0,
        filenamePrefix: "original",
      };
  }
}

/**
 * Calcula el recorte centrado 9:16 vertical para historias sin distorsionar la imagen.
 */
export function calculateStoriesCrop(width: number, height: number): CropArea {
  const targetRatio = 9 / 16;
  const currentRatio = width / height;

  let cropW = width;
  let cropH = height;

  if (currentRatio > targetRatio) {
    // La imagen es más ancha que 9:16: recortar bordes izquierdo y derecho
    cropW = Math.round(height * targetRatio);
    cropH = height;
  } else if (currentRatio < targetRatio) {
    // La imagen es más alta que 9:16: recortar arriba y abajo
    cropW = width;
    cropH = Math.round(width / targetRatio);
  }

  const originX = Math.max(0, Math.round((width - cropW) / 2));
  const originY = Math.max(0, Math.round((height - cropH) / 2));

  return {
    originX,
    originY,
    width: cropW,
    height: cropH,
  };
}

/**
 * Calcula el tamaño escalado manteniendo la relación de aspecto si supera el límite del preset.
 */
export function calculateScaledDimensions(
  width: number,
  height: number,
  maxDimension?: number,
): TargetDimensions {
  if (!maxDimension) {
    return { width, height };
  }

  const currentMax = Math.max(width, height);
  if (currentMax <= maxDimension) {
    return { width, height };
  }

  const scale = maxDimension / currentMax;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

// ---------- Bloque 7: perfiles de compartición ----------

export type SharePresetId = "messaging" | "social_hd" | "email" | "original";

export interface SharePresetConfig {
  id: SharePresetId;
  label: string;
  maxDimensionPx: number | null;
  quality: number;
  stripExif: boolean;
  maxVideoSizeBytes: number | null;
  targetVideoBitrateBps: number | null;
}

export const SHARE_PRESETS: Record<SharePresetId, SharePresetConfig> = {
  messaging: {
    id: "messaging",
    label: "Rápido (WhatsApp / Telegram)",
    maxDimensionPx: 1600,
    quality: 0.82,
    stripExif: true,
    maxVideoSizeBytes: 16 * 1024 * 1024,
    targetVideoBitrateBps: 2_500_000,
  },
  social_hd: {
    id: "social_hd",
    label: "Redes HD (Instagram / Stories)",
    maxDimensionPx: 2048,
    quality: 0.88,
    stripExif: true,
    maxVideoSizeBytes: 50 * 1024 * 1024,
    targetVideoBitrateBps: 4_500_000,
  },
  email: {
    id: "email",
    label: "Correo ligero",
    maxDimensionPx: 1280,
    quality: 0.78,
    stripExif: true,
    maxVideoSizeBytes: 10 * 1024 * 1024,
    targetVideoBitrateBps: 1_800_000,
  },
  original: {
    id: "original",
    label: "Archivo original (con EXIF/GPS)",
    maxDimensionPx: null,
    quality: 1,
    stripExif: false,
    maxVideoSizeBytes: null,
    targetVideoBitrateBps: null,
  },
};

export interface ShareTargetDimensions {
  width: number;
  height: number;
  needsResize: boolean;
  needsReencode: boolean;
}

export function computeShareTargetDimensions(
  sourceWidth: number,
  sourceHeight: number,
  presetId: SharePresetId,
  sourceSizeBytes?: number,
): ShareTargetDimensions {
  const preset = SHARE_PRESETS[presetId];
  const w = Math.max(1, Math.round(sourceWidth));
  const h = Math.max(1, Math.round(sourceHeight));
  if (preset.id === "original" || !preset.maxDimensionPx) {
    return { width: w, height: h, needsResize: false, needsReencode: false };
  }
  const longestSide = Math.max(w, h);
  if (longestSide <= preset.maxDimensionPx) {
    const alreadyCompact =
      typeof sourceSizeBytes === "number" && sourceSizeBytes > 0 && sourceSizeBytes <= 450 * 1024;
    return {
      width: w,
      height: h,
      needsResize: false,
      needsReencode: preset.stripExif || !alreadyCompact,
    };
  }
  const scale = preset.maxDimensionPx / longestSide;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    needsResize: true,
    needsReencode: true,
  };
}

export interface VideoOptimizationPlan {
  passthrough: boolean;
  targetWidth: number;
  targetHeight: number;
  targetBitrateBps: number;
  estimatedOutputBytes: number;
}

export function planVideoOptimization(
  sourceWidth: number,
  sourceHeight: number,
  durationMs: number,
  sourceSizeBytes: number,
  presetId: SharePresetId,
): VideoOptimizationPlan {
  const preset = SHARE_PRESETS[presetId];
  const w = Math.max(1, Math.round(sourceWidth));
  const h = Math.max(1, Math.round(sourceHeight));
  const durationSec = Math.max(0.5, durationMs / 1000);
  const currentBitrateBps = Math.round((sourceSizeBytes * 8) / durationSec);

  if (preset.id === "original" || !preset.maxDimensionPx || !preset.targetVideoBitrateBps) {
    return {
      passthrough: true,
      targetWidth: w,
      targetHeight: h,
      targetBitrateBps: currentBitrateBps,
      estimatedOutputBytes: sourceSizeBytes,
    };
  }

  const withinSizeLimit = !preset.maxVideoSizeBytes || sourceSizeBytes <= preset.maxVideoSizeBytes;
  const withinBitrateLimit = currentBitrateBps <= preset.targetVideoBitrateBps * 1.15;
  const withinDimensionLimit = Math.max(w, h) <= preset.maxDimensionPx;

  if (withinSizeLimit && withinBitrateLimit && withinDimensionLimit) {
    return {
      passthrough: true,
      targetWidth: w,
      targetHeight: h,
      targetBitrateBps: currentBitrateBps,
      estimatedOutputBytes: sourceSizeBytes,
    };
  }

  const longest = Math.max(w, h);
  const scale = longest > preset.maxDimensionPx ? preset.maxDimensionPx / longest : 1;
  const targetWidth = Math.max(2, Math.round((w * scale) / 2) * 2);
  const targetHeight = Math.max(2, Math.round((h * scale) / 2) * 2);

  const maxBitrateByBudget = preset.maxVideoSizeBytes
    ? Math.floor((preset.maxVideoSizeBytes * 8 * 0.92) / durationSec)
    : preset.targetVideoBitrateBps;
  const targetBitrateBps = Math.max(
    600_000,
    Math.min(preset.targetVideoBitrateBps, maxBitrateByBudget),
  );
  const estimatedOutputBytes = Math.round((targetBitrateBps * durationSec) / 8);

  return { passthrough: false, targetWidth, targetHeight, targetBitrateBps, estimatedOutputBytes };
}
