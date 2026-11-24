export type ResizeSpec = { width: number } | { height: number } | null;

/**
 * Cómo reducir para que el LADO MAYOR no pase de `maxDim` (regla de miniaturas, AGENTS.md)
 * sin ampliar nunca. Devuelve null si ya cabe (no hace falta redimensionar). Sin dimensiones
 * conocidas cae al comportamiento anterior (ancho = maxDim).
 */
export function fitResize(
  dims: { width: number; height: number } | undefined,
  maxDim: number,
): ResizeSpec {
  if (!dims || !(dims.width > 0) || !(dims.height > 0)) return { width: maxDim };
  if (Math.max(dims.width, dims.height) <= maxDim) return null;
  return dims.width >= dims.height ? { width: maxDim } : { height: maxDim };
}
