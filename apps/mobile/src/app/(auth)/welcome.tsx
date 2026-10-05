import { router } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "../../i18n/es";
import { Button } from "../../ui";

export default function Welcome() {
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <View className="flex-1 px-6 justify-center gap-6">
        <View className="items-center gap-4">
          <View className="w-24 h-24 rounded-3xl bg-accent items-center justify-center">
            <Text className="text-5xl">📸</Text>
          </View>
          <Text className="text-3xl font-bold text-neutral-900 dark:text-white text-center">
            {t.auth.welcomeTitle}
          </Text>
          <Text className="text-base text-neutral-500 dark:text-neutral-400 text-center leading-6">
            {t.auth.welcomeBody}
          </Text>
        </View>
      </View>
      <View className="px-6 pb-6 gap-3">
        <Button label={t.auth.register} onPress={() => router.push("/register")} />
        <Button label={t.auth.login} variant="ghost" onPress={() => router.push("/login")} />
      </View>
    </SafeAreaView>
  );
}
