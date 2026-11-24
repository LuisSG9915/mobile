import { type Action, manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as MediaLibrary from "expo-media-library";
import { enqueueAsset, enqueueAssetsBatch } from "../queue/db";
import { type AspectRatioOption, aspectRatioValue } from "./image-editor-calc";

export type { AspectRatioOption };

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
  const targetRatio = aspectRatioValue(options.aspectRatio);
  if (targetRatio !== null) {
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
    const asset = await MediaLibrary.createAssetAsync(result.uri);
    if (asset) {
      await enqueueAsset({
        id: asset.id,
        uri: asset.uri,
        filename: asset.filename ?? `edited_${Date.now()}.jpg`,
        mediaType: "photo",
        creationTime: asset.creationTime,
      });
    }
  } catch (err) {
    console.warn("No se pudo crear o encolar el asset editado en MediaLibrary:", err);
    try {
      await MediaLibrary.saveToLibraryAsync(result.uri);
    } catch (saveErr) {
      console.warn("No se pudo guardar la imagen editada en MediaLibrary:", saveErr);
    }
  }

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
  };
}

// ---------- Bloque 5: render en una sola pasada ----------
import * as ImageManipulator from "expo-image-manipulator";
import { type PhotoEditRecipe, resolvePixelCropRect } from "./image-editor-calc";

export interface CommitPhotoEditInput {
  sourceUri: string;
  sourceWidth: number;
  sourceHeight: number;
  recipe: PhotoEditRecipe;
  quality?: number;
  saveToDeviceLibrary?: boolean;
  originalFilename?: string;
}

export interface CommitPhotoEditResult {
  uri: string;
  width: number;
  height: number;
  savedAssetId?: string;
}

// ---------- Bloque 6: render + color matrix nativa ----------
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import { buildColorMatrix20, hasColorAdjustments } from "./image-editor-calc";

interface NativeImageColorModule {
  applyColorMatrix(
    sourceUri: string,
    matrixValues: number[],
    quality?: number,
  ): Promise<{ uri: string; width: number; height: number }>;
}

const nativeColorModule =
  Platform.OS === "android"
    ? requireOptionalNativeModule<NativeImageColorModule>("VideoThumbnail")
    : null;

export async function renderEditedPhotoNative(
  input: CommitPhotoEditInput,
): Promise<CommitPhotoEditResult> {
  const { sourceUri, sourceWidth, sourceHeight, recipe } = input;
  const actions: ImageManipulator.Action[] = [];

  const totalAngle = (recipe.rotation + recipe.straightenDeg + 360) % 360;
  if (Math.abs(totalAngle) > 0.01) actions.push({ rotate: totalAngle });
  if (recipe.flipHorizontal) actions.push({ flip: ImageManipulator.FlipType.Horizontal });
  if (recipe.flipVertical) actions.push({ flip: ImageManipulator.FlipType.Vertical });

  const pixelCrop = resolvePixelCropRect(
    sourceWidth,
    sourceHeight,
    recipe.rotation,
    recipe.crop,
    recipe.straightenDeg,
  );
  const isFullFrame =
    pixelCrop.originX === 0 &&
    pixelCrop.originY === 0 &&
    Math.abs(recipe.straightenDeg) < 0.01 &&
    recipe.crop.width >= 0.999 &&
    recipe.crop.height >= 0.999;

  if (!isFullFrame) actions.push({ crop: pixelCrop });

  const compressRatio = input.quality ?? 0.92;
  let finalResult = await ImageManipulator.manipulateAsync(sourceUri, actions, {
    compress: compressRatio,
    format: ImageManipulator.SaveFormat.WEBP,
  });

  if (hasColorAdjustments(recipe) && nativeColorModule?.applyColorMatrix) {
    try {
      const matrix20 = buildColorMatrix20(recipe);
      finalResult = await nativeColorModule.applyColorMatrix(
        finalResult.uri,
        matrix20,
        Math.round(compressRatio * 100),
      );
    } catch (err) {
      console.warn("[image-editor] Falló applyColorMatrix nativo:", err);
    }
  }

  let savedAssetId: string | undefined;
  if (input.saveToDeviceLibrary) {
    const createdAsset = await MediaLibrary.createAssetAsync(finalResult.uri);
    savedAssetId = createdAsset.id;
    const baseName = (input.originalFilename ?? "photo").replace(/\.[^.]+$/, "");
    await enqueueAssetsBatch([
      {
        id: createdAsset.id,
        uri: createdAsset.uri,
        filename: `${baseName}_edited_${Date.now()}.webp`,
        mediaType: "photo",
        creationTime: Date.now(),
      } as any,
    ]);
  }

  return {
    uri: finalResult.uri,
    width: finalResult.width,
    height: finalResult.height,
    savedAssetId,
  };
}
