import { Tabs } from "expo-router";
import { CloudUpload, Images, Settings } from "lucide-react-native";
import { ActivityIndicator, Platform, Text, View } from "react-native";
import { t } from "../../i18n/es";
import { useBackupRunner } from "../../queue/runner";
import { useQueueSession } from "../../queue/session";

export default function TabsLayout() {
  // En web abre IndexedDB por usuario y suspende la cola si la sesión cae;
  // en nativo devuelve { ready: true } y es un no-op.
  const { ready, error } = useQueueSession();
  useBackupRunner(ready);

  if (Platform.OS === "web" && error) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black px-6">
        <Text className="text-base text-neutral-700 dark:text-neutral-300 text-center">
          {error}
        </Text>
      </View>
    );
  }
  if (Platform.OS === "web" && !ready) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black gap-3">
        <ActivityIndicator color="#4f46e5" />
        <Text className="text-sm text-neutral-500">{t.queue.preparing}</Text>
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#4f46e5",
        tabBarInactiveTintColor: "#a3a3a3",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t.tabs.photos,
          tabBarIcon: ({ color, size }) => <Images color={color} size={size} />,
          tabBarAccessibilityLabel: t.tabs.photos,
        }}
      />
      <Tabs.Screen
        name="backup"
        options={{
          title: t.tabs.backup,
          tabBarIcon: ({ color, size }) => <CloudUpload color={color} size={size} />,
          tabBarAccessibilityLabel: t.tabs.backup,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t.tabs.settings,
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
          tabBarAccessibilityLabel: t.tabs.settings,
        }}
      />
    </Tabs>
  );
}
