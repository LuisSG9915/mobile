import { TRASH_RETENTION_DAYS } from "@photos/shared";
import { FlashList } from "@shopify/flash-list";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { api } from "../api/client";
import { t } from "../i18n/es";
import { Button, EmptyState } from "../ui";

export default function TrashScreen() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["trash"], queryFn: api.trash });
  const restore = useMutation({
    mutationFn: api.restoreMedia,
    onSuccess: () => {
      toast.success(t.trash.restored);
      void qc.invalidateQueries({ queryKey: ["trash"] });
      void qc.invalidateQueries({ queryKey: ["timeline"] });
    },
  });

  const items = query.data?.items ?? [];

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top", "bottom"]}>
      <View className="px-5 py-4 gap-1">
        <Text className="text-2xl font-bold text-neutral-900 dark:text-white">{t.trash.title}</Text>
        <Text className="text-sm text-neutral-500">{t.trash.body}</Text>
      </View>
      {items.length === 0 ? (
        <EmptyState title={t.trash.empty} />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(i) => i.id}
          numColumns={1}
          renderItem={({ item }) => (
            <View className="flex-row items-center px-5 py-2 gap-3">
              <Image
                source={{ uri: item.thumbUrl }}
                placeholder={{ thumbhash: item.thumbhash }}
                style={{ width: 64, height: 64, borderRadius: 12 }}
                contentFit="cover"
              />
              <View className="flex-1">
                <Text className="text-sm font-medium text-neutral-900 dark:text-white">
                  {item.mediaType === "video" ? "Video" : "Foto"}
                </Text>
                <Text className="text-xs text-neutral-500">
                  {t.trash.daysLeft(TRASH_RETENTION_DAYS)}
                </Text>
              </View>
              <View className="w-28">
                <Button
                  label={t.trash.restore}
                  variant="ghost"
                  onPress={() => restore.mutate(item.id)}
                />
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
