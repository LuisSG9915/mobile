import * as Linking from "expo-linking";

/**
 * Destino del enlace de verificación de correo. El correo lleva una URL del API
 * (`/api/auth/verify-email?token=…&callbackURL=<esto>`) que valida el token
 * y redirige aquí.
 * En web vuelve al mismo origen (`${origin}/welcome`, aterrizando en welcome.tsx).
 * En nativo devuelve el deep link `photos:///welcome` usando expo-linking sin hardcodear el host.
 */
export function verificationRedirectTarget(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/welcome`;
  }
  return Linking.createURL("welcome");
}
