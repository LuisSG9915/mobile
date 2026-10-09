import "../../global.css";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Toaster } from "sonner-native";
import { useSession } from "../auth/client";
import { queryClient } from "../lib/query-client";
import { registerBackupTask } from "../queue/background";

function RootNavigator() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator color="#4f46e5" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={Boolean(session)}>
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="media/[id]"
          options={{ presentation: "fullScreenModal", animation: "fade" }}
        />
        <Stack.Screen name="trash" options={{ presentation: "modal" }} />
        <Stack.Screen name="cleaner" />
        <Stack.Screen name="map" />
        <Stack.Screen name="search" />
        <Stack.Screen name="admin" />
        <Stack.Screen name="albums/[id]" />
      </Stack.Protected>
      <Stack.Screen name="shared/album/[token]" />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    void registerBackupTask();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <BottomSheetModalProvider>
            <RootNavigator />
            <Toaster />
          </BottomSheetModalProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
