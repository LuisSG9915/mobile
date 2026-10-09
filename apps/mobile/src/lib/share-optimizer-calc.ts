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
