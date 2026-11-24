import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "../i18n/es";

/** En el navegador la descarga masiva ya existe como ZIP desde la galería. */
export default function RestoreWebScreen() {
  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black">
      <View className="px-5 py-4 gap-2">
        <Text className="text-2xl font-bold text-neutral-900 dark:text-white">
          {t.restore.title}
        </Text>
        <Text className="text-sm text-neutral-500">{t.restore.webHint}</Text>
      </View>
    </SafeAreaView>
  );
}
