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
