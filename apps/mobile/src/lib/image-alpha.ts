/**
 * ¿Se puede decodificar en RGB_565 sin riesgo? Ese formato no tiene canal alfa: en PNG, WebP
 * o GIF con transparencia los píxeles transparentes salen NEGROS (miniaturas negras).
 * Solo es seguro para JPEG (siempre opaco) y para las miniaturas remotas que genera la app.
 */
export function canDecodeWithoutAlpha(uri: string | null | undefined): boolean {
  if (!uri) return false;
  if (uri.startsWith("http://") || uri.startsWith("https://")) return true; // miniaturas remotas
  const path = uri.split("?")[0].toLowerCase();
  return path.endsWith(".jpg") || path.endsWith(".jpeg");
}
