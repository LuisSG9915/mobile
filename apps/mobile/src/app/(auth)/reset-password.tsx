import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { resetPassword } from "../../auth/client";
import { t } from "../../i18n/es";
import { Button, Field } from "../../ui";

/**
 * Destino del enlace del correo: `photos:///reset-password?token=…` (o el
 * origen web). La API adjunta `?error=INVALID_TOKEN` si el enlace expiró.
 */
export default function ResetPassword() {
  const params = useLocalSearchParams<{ token?: string; error?: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const invalidLink = Boolean(params.error) || !token;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    if (password.length < 8) {
      setError(t.auth.resetTooShort);
      return;
    }
    if (password !== confirm) {
      setError(t.auth.resetMismatch);
      return;
    }
    setLoading(true);
    const res = await resetPassword({ newPassword: password, token: token ?? "" });
    setLoading(false);
    if (res.error) {
      setError(res.error.code === "INVALID_TOKEN" ? t.auth.resetInvalid : t.auth.genericError);
      return;
    }
    setDone(true);
  };

  const body = invalidLink ? (
    <View className="gap-6">
      <View className="gap-1">
        <Text className="text-3xl font-bold text-neutral-900 dark:text-white">
          {t.auth.forgotTitle}
        </Text>
        <Text className="text-base text-neutral-500">{t.auth.resetInvalid}</Text>
      </View>
      <Button label={t.auth.forgotAction} onPress={() => router.replace("/forgot-password")} />
      <Button label={t.auth.backToLogin} variant="ghost" onPress={() => router.replace("/login")} />
    </View>
  ) : done ? (
    <View className="gap-6">
      <View className="gap-1">
        <Text className="text-3xl font-bold text-neutral-900 dark:text-white">
          {t.auth.forgotTitle}
        </Text>
        <Text className="text-base text-neutral-500">{t.auth.resetDone}</Text>
      </View>
      <Button label={t.auth.backToLogin} onPress={() => router.replace("/login")} />
    </View>
  ) : (
    <View className="gap-6">
      <View className="gap-1">
        <Text className="text-3xl font-bold text-neutral-900 dark:text-white">
          {t.auth.resetTitle}
        </Text>
      </View>
      <View className="gap-4">
        <Field
          label={t.auth.resetNewPassword}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
        />
        <Field
          label={t.auth.resetConfirm}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoComplete="new-password"
        />
      </View>
      {error ? <Text className="text-red-600 text-sm">{error}</Text> : null}
      <Button
        label={t.auth.resetAction}
        onPress={submit}
        loading={loading}
        disabled={!password || !confirm}
      />
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView contentContainerClassName="px-6 pt-10" keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
