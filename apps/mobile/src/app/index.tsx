import { Redirect } from "expo-router";
import { ActivityIndicator, Platform, View } from "react-native";
import { useSession } from "../auth/client";
import { useSettings } from "../lib/store";

export default function Index() {
  const { data: session, isPending } = useSession();
  const onboarded = useSettings((s) => s.onboarded);

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator color="#4f46e5" />
      </View>
    );
  }
  if (!session) return <Redirect href="/welcome" />;
  // En web no hay permisos de biblioteca: la subida es manual desde Respaldo.
  if (Platform.OS !== "web" && !onboarded) return <Redirect href="/permissions" />;
  return <Redirect href="/(tabs)" />;
}
