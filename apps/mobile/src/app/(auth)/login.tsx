import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { signIn } from "../../auth/client";
import { t } from "../../i18n/es";
import { Button, Field } from "../../ui";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    const res = await signIn.email({ email: email.trim(), password });
    setLoading(false);
    if (res.error) {
      setError(
        res.error.status === 401
          ? t.auth.invalidCredentials
          : (res.error.message ?? t.auth.genericError),
      );
      return;
    }
    router.replace("/permissions");
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
          <View className="gap-1">
            <Text className="text-3xl font-bold text-neutral-900 dark:text-white">
              {t.auth.loginSubtitle}
            </Text>
            <Text className="text-base text-neutral-500">{t.auth.login}</Text>
          </View>
          <View className="gap-4">
            <Field
              label={t.auth.email}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
            />
            <Field
              label={t.auth.password}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
            />
          </View>
          {error ? <Text className="text-red-600 text-sm">{error}</Text> : null}
          <Button
            label={t.auth.login}
            onPress={submit}
            loading={loading}
            disabled={!email || !password}
          />
          <Pressable onPress={() => router.push("/forgot-password")} className="items-center">
            <Text className="text-neutral-500 text-sm">{t.auth.forgotPassword}</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/register")} className="items-center py-2">
            <Text className="text-accent font-medium">{t.auth.noAccount}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
