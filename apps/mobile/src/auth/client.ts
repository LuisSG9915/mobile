import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

/**
 * URL del API. En desarrollo con dispositivo físico usar la IP LAN del PC
 * (EXPO_PUBLIC_API_URL en .env, ej. http://192.168.1.x:8787).
 * En emulador Android también sirve `adb reverse tcp:8787 tcp:8787`.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.hostUri
    ? `http://${Constants.expoConfig.hostUri.split(":")[0]}:8787`
    : "http://localhost:8787");

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    expoClient({
      scheme: "photos",
      storagePrefix: "photos",
      storage: SecureStore,
    }),
  ],
});

export const { useSession, signIn, signUp, signOut, requestPasswordReset, resetPassword } =
  authClient;

/** Headers de autenticación para fetch directo al API (cookie en móvil). */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const cookie = await authClient.getCookie();
  return cookie ? { cookie } : {};
}
