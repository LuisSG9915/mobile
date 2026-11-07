import { Text, View } from "react-native";

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2 border-b border-neutral-100 dark:border-neutral-800">
      <Text className="text-sm text-neutral-500">{label}</Text>
      <Text className="text-sm font-medium text-neutral-900 dark:text-white">{value}</Text>
    </View>
  );
}
