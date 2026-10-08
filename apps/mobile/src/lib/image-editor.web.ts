import { enqueueAsset } from "../queue/db";
import type { AspectRatioOption, EditPhotoOptions, EditPhotoResult } from "./image-editor";

export type { AspectRatioOption, EditPhotoOptions, EditPhotoResult };

/**
 * Aplica rotación y recorte sobre una imagen en el navegador mediante HTML5 Canvas,
 * descarga opcional y persistencia en IndexedDB para respaldo inmediato.
 */
export async function processAndSaveEditedPhoto(
  options: EditPhotoOptions,
): Promise<EditPhotoResult> {
  return new Promise((resolve, reject) => {
    const img = document.createElement("img");
    img.crossOrigin = "anonymous";

    img.onload = async () => {
      try {
        const normalizedRotation = ((options.rotationDegrees % 360) + 360) % 360;
        const isRotated90 = normalizedRotation === 90 || normalizedRotation === 270;
        const origW = img.naturalWidth || options.imageWidth;
        const origH = img.naturalHeight || options.imageHeight;

        // Dimensiones rotadas
        const rotW = isRotated90 ? origH : origW;
        const rotH = isRotated90 ? origW : origH;

        let targetCropW = rotW;
        let targetCropH = rotH;

        if (options.aspectRatio !== "original") {
          let targetRatio = 1;
          if (options.aspectRatio === "1:1") targetRatio = 1;
          else if (options.aspectRatio === "4:3") targetRatio = 4 / 3;
          else if (options.aspectRatio === "16:9") targetRatio = 16 / 9;

          if (rotW / rotH > targetRatio) {
            targetCropW = Math.round(rotH * targetRatio);
            targetCropH = rotH;
          } else {
            targetCropW = rotW;
            targetCropH = Math.round(rotW / targetRatio);
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetCropW;
        canvas.height = targetCropH;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("No se pudo obtener el contexto 2D del canvas");

        ctx.save();
        // Mover el punto de origen al centro del canvas de destino
        ctx.translate(targetCropW / 2, targetCropH / 2);
        ctx.rotate((normalizedRotation * Math.PI) / 180);
        // Dibujar la imagen centrada
        ctx.drawImage(img, -origW / 2, -origH / 2, origW, origH);
        ctx.restore();

        canvas.toBlob(
          async (blob) => {
            if (!blob) {
              reject(new Error("Error al exportar la imagen editada desde el canvas"));
              return;
            }

            const blobUrl = URL.createObjectURL(blob);
            const filename = `edited_${Date.now()}.jpg`;
            const file = new File([blob], filename, {
              type: "image/jpeg",
              lastModified: Date.now(),
            });

            // Persistir en cola de IndexedDB para respaldo
            try {
              await enqueueAsset(
                {
                  id: crypto.randomUUID(),
                  uri: blobUrl,
                  filename,
                  mediaType: "photo",
                  creationTime: Date.now(),
                },
                file,
              );
            } catch (err) {
              console.warn("No se pudo encolar la foto editada en web:", err);
            }

            resolve({
              uri: blobUrl,
              width: targetCropW,
              height: targetCropH,
            });
          },
          "image/jpeg",
          0.95,
        );
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => reject(new Error("No se pudo cargar la imagen para procesar"));
    img.src = options.uri;
  });
}
