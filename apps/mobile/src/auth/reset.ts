/**
 * Destino del enlace de recuperación. El correo lleva una URL del API
 * (`/api/auth/reset-password/{token}?callbackURL=<esto>`) que valida el token
 * y redirige aquí con `?token=…` o `?error=INVALID_TOKEN`.
 * En web vuelve al mismo origen (incluido en WEB_ORIGINS del API); en nativo
 * es el deep link del scheme `photos` (trustedOrigins cubre `photos://`).
 */
export function resetRedirectTarget(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/reset-password`;
  }
  return "photos:///reset-password";
}
