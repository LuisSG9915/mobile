import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { signUp } from "../../auth/client";
import { t } from "../../i18n/es";
import { useSettings } from "../../lib/store";
import { Button, Field } from "../../ui";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setLoading(true);
    try {
      const res = await signUp.email({ name: name.trim(), email: email.trim(), password });
      if (res?.error) {
        setError(res.error.message ?? t.auth.genericError);
        return;
      }
      const onboarded = useSettings.getState().onboarded;
      if (Platform.OS !== "web" && !onboarded) {
        router.replace("/permissions");
      } else {
        router.replace("/(tabs)");
      }
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
          <View className="gap-1">
            <Text className="text-3xl font-bold text-neutral-900 dark:text-white">
              {t.auth.registerSubtitle}
            </Text>
          </View>
          <View className="gap-4">
            <Field
              label={t.auth.name}
              value={name}
              onChangeText={setName}
              autoComplete="name"
              autoCapitalize="words"
            />
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
              autoComplete="new-password"
            />
          </View>
          {error ? <Text className="text-red-600 text-sm">{error}</Text> : null}
          <Button
            label={t.auth.register}
            onPress={submit}
            loading={loading}
            disabled={!name || !email || !password}
          />
          <Pressable onPress={() => router.push("/login")} className="items-center py-2">
            <Text className="text-accent font-medium">{t.auth.haveAccount}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
