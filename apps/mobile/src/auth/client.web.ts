import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";

/**
 * URL del API. En desarrollo apuntar al wrangler dev local (http://localhost:8787)
 * o al worker desplegado (EXPO_PUBLIC_API_URL en .env).
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.hostUri
    ? `http://${Constants.expoConfig.hostUri.split(":")[0]}:8787`
    : "http://localhost:8787");

// En web no hay SecureStore y las cookies de terceros las bloquean los
// navegadores: la sesión viaja en Authorization: Bearer (plugin bearer del API).
const TOKEN_KEY = "photos.session_token";

function readToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: {
    // Sin cookies: la sesión viaja solo en Authorization (Bearer).
    credentials: "omit",
    auth: { type: "Bearer", token: readToken },
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get("set-auth-token");
      if (!token) return;
      try {
        localStorage.setItem(TOKEN_KEY, token);
      } catch {}
    },
  },
});

export const { useSession, signIn, signUp, requestPasswordReset, resetPassword } = authClient;

export const signOut: typeof authClient.signOut = async (options) => {
  try {
    return await authClient.signOut(options);
  } finally {
    clearToken();
  }
};

/** Headers de autenticación para fetch directo al API (Bearer en web). */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = readToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}
