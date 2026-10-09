import { Redirect, Stack } from "expo-router";
import { Platform } from "react-native";
import { useSession } from "../../auth/client";
import { useSettings } from "../../lib/store";

export default function OnboardingLayout() {
  const { data: session } = useSession();
  const onboarded = useSettings((s) => s.onboarded);

  if (!session) {
    return <Redirect href="/welcome" />;
  }

  // En web no hay onboarding de permisos locales de galería, o si ya se concedieron
  if (Platform.OS === "web" || onboarded) {
    return <Redirect href="/(tabs)" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
