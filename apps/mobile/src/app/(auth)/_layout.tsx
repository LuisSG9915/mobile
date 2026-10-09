import { Redirect, Stack } from "expo-router";
import { useSession } from "../../auth/client";

export default function AuthLayout() {
  const { data: session } = useSession();

  // Si ya tiene sesión activa, redirige inmediatamente a la aplicación
  if (session) {
    return <Redirect href="/(tabs)" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
