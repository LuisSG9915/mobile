import { type Action, manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as MediaLibrary from "expo-media-library";

export type AspectRatioOption = "original" | "1:1" | "4:3" | "16:9";

export type EditPhotoOptions = {
  uri: string;
  rotationDegrees: number;
  aspectRatio: AspectRatioOption;
  imageWidth: number;
  imageHeight: number;
};

export type EditPhotoResult = {
  uri: string;
  width: number;
  height: number;
};

/**
 * Aplica rotación y recorte sobre una imagen en el dispositivo y la guarda
 * en la biblioteca multimedia (MediaLibrary) para que sea respaldada.
 */
export async function processAndSaveEditedPhoto(
  options: EditPhotoOptions,
): Promise<EditPhotoResult> {
  const actions: Action[] = [];

  // 1. Rotación si es distinta de 0
  const normalizedRotation = ((options.rotationDegrees % 360) + 360) % 360;
  if (normalizedRotation !== 0) {
    actions.push({ rotate: normalizedRotation });
  }

  // Dimensiones tras la rotación
  const isRotated90or270 = normalizedRotation === 90 || normalizedRotation === 270;
  const currentW = isRotated90or270 ? options.imageHeight : options.imageWidth;
  const currentH = isRotated90or270 ? options.imageWidth : options.imageHeight;

  // 2. Recorte si la relación de aspecto no es la original
  if (options.aspectRatio !== "original") {
    let targetRatio = 1;
    if (options.aspectRatio === "1:1") targetRatio = 1;
    else if (options.aspectRatio === "4:3") targetRatio = 4 / 3;
    else if (options.aspectRatio === "16:9") targetRatio = 16 / 9;

    let cropWidth = currentW;
    let cropHeight = currentH;

    if (currentW / currentH > targetRatio) {
      cropWidth = Math.round(currentH * targetRatio);
      cropHeight = currentH;
    } else {
      cropWidth = currentW;
      cropHeight = Math.round(currentW / targetRatio);
    }

    const originX = Math.max(0, Math.round((currentW - cropWidth) / 2));
    const originY = Math.max(0, Math.round((currentH - cropHeight) / 2));

    actions.push({
      crop: {
        originX,
        originY,
        width: cropWidth,
        height: cropHeight,
      },
    });
  }

  const result = await manipulateAsync(options.uri, actions, {
    compress: 0.95,
    format: SaveFormat.JPEG,
  });

  try {
    await MediaLibrary.saveToLibraryAsync(result.uri);
  } catch (err) {
    console.warn("No se pudo guardar la imagen editada en MediaLibrary:", err);
  }

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
  };
}
