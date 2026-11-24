import { ApiError } from "../api/client";
import { t } from "../i18n/es";

const NETWORK_RE =
  /network request failed|failed to fetch|networkerror|load failed|timeout|timed out/i;

/**
 * Mensaje apto para mostrar al usuario (en español). Los ApiError ya traen el
 * texto del servidor; los errores de red del runtime llegan en inglés.
 */
const SPANISH_RE = /[áéíóúñ¿¡]|\b(la|el|tu|de|no)\b/i;

export function toUserMessage(err: unknown, fallback: string = t.auth.genericError): string {
  if (err instanceof ApiError) return err.message || fallback;
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (NETWORK_RE.test(message)) return t.common.networkError;
  // Mensajes ya localizados (p. ej. el timeout propio del cliente) se respetan.
  if (message && SPANISH_RE.test(message)) return message;
  return fallback;
}
