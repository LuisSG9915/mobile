import { router } from "expo-router";
import { useState } from "react";
import { Linking, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "../../i18n/es";
import { useSettings } from "../../lib/store";
import { requestMediaPermissions } from "../../queue/permissions";
import { runBackupPass } from "../../queue/runner";
import { Button, Card } from "../../ui";

function PermissionRow({ title, why }: { title: string; why: string }) {
  return (
    <View className="flex-row gap-3 items-start">
      <View className="w-9 h-9 rounded-full bg-accent-soft items-center justify-center">
        <View className="w-2.5 h-2.5 rounded-full bg-accent" />
      </View>
      <View className="flex-1">
        <Text className="text-base font-semibold text-neutral-900 dark:text-white">{title}</Text>
        <Text className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">{why}</Text>
      </View>
    </View>
  );
}

export default function Permissions() {
  const setOnboarded = useSettings((s) => s.setOnboarded);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);

  const ask = async () => {
    setLoading(true);
    const res = await requestMediaPermissions();
    setLoading(false);
    if (!res.granted) {
      setDenied(true);
      return;
    }
    setOnboarded(true);
    // Primera activación: escanear ya, sin esperar al intervalo.
    void runBackupPass({ forceScan: true }).catch(() => {});
    router.replace("/(tabs)");
  };

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <View className="flex-1 px-6 pt-10 gap-6">
        <Text className="text-3xl font-bold text-neutral-900 dark:text-white">
          {t.onboarding.title}
        </Text>
        <Text className="text-base text-neutral-500 dark:text-neutral-400 leading-6">
          {t.onboarding.body}
        </Text>
        <Card className="gap-4">
          <PermissionRow title={t.onboarding.photos} why={t.onboarding.photosWhy} />
          <PermissionRow title={t.onboarding.mediaLocation} why={t.onboarding.mediaLocationWhy} />
        </Card>
        {denied ? (
          <Card className="gap-2 border-amber-300 dark:border-amber-700">
            <Text className="font-semibold text-amber-700 dark:text-amber-400">
              {t.onboarding.deniedTitle}
            </Text>
            <Text className="text-sm text-neutral-500 dark:text-neutral-400">
              {t.onboarding.deniedBody}
            </Text>
            <Button
              label={t.onboarding.openSettings}
              variant="ghost"
              onPress={() => Linking.openSettings()}
            />
          </Card>
        ) : null}
      </View>
      <View className="px-6 pb-8">
        <Button label={t.onboarding.continue} onPress={ask} loading={loading} />
      </View>
    </SafeAreaView>
  );
}
