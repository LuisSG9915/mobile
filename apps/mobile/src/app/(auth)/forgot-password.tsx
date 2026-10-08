import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { requestPasswordReset } from "../../auth/client";
import { resetRedirectTarget } from "../../auth/reset";
import { t } from "../../i18n/es";
import { Button, Field } from "../../ui";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await requestPasswordReset({
        email: email.trim(),
        redirectTo: resetRedirectTarget(),
      });
      if (res?.error) {
        setError(res.error.status === 429 ? t.auth.tooManyAttempts : t.auth.genericError);
        return;
      }
      // La API responde igual exista o no el correo (anti-enumeración):
      // confirmación genérica siempre.
      setSent(true);
    } catch {
      setError(t.auth.genericError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="px-6 pt-10 gap-6"
          keyboardShouldPersistTaps="handled"
        >
          {sent ? (
            <View className="gap-6">
              <View className="gap-1">
                <Text className="text-3xl font-bold text-neutral-900 dark:text-white">
                  {t.auth.forgotSentTitle}
                </Text>
                <Text className="text-base text-neutral-500">{t.auth.forgotSentBody}</Text>
              </View>
              <Button label={t.auth.backToLogin} onPress={() => router.replace("/login")} />
            </View>
          ) : (
            <View className="gap-6">
              <View className="gap-1">
                <Text className="text-3xl font-bold text-neutral-900 dark:text-white">
                  {t.auth.forgotTitle}
                </Text>
                <Text className="text-base text-neutral-500">{t.auth.forgotBody}</Text>
              </View>
              <Field
                label={t.auth.email}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoComplete="email"
              />
              {error ? <Text className="text-red-600 text-sm">{error}</Text> : null}
              <Button
                label={t.auth.forgotAction}
                onPress={submit}
                loading={loading}
                disabled={!email}
              />
              <Pressable onPress={() => router.back()} className="items-center py-2">
                <Text className="text-accent font-medium">{t.auth.backToLogin}</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
