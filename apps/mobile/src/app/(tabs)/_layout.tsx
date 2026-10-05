import { Tabs } from "expo-router";
import { CloudUpload, Images, Settings } from "lucide-react-native";
import { t } from "../../i18n/es";

export default function TabsLayout() {
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
