import { TRASH_RETENTION_DAYS, type TrashItem } from "@photos/shared";
import { FlashList } from "@shopify/flash-list";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Alert, Platform, Text, View } from "react-native";
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
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const emptyTrashMut = useMutation({
    mutationFn: api.emptyTrash,
    onSuccess: () => {
      toast.success(t.trash.emptySuccess);
      void qc.invalidateQueries({ queryKey: ["trash"] });
      void qc.invalidateQueries({ queryKey: ["timeline"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["user-storage"] });
    },
    onError: (err: Error) => toast.error(err.message || t.auth.genericError),
  });

  const handleEmptyTrash = () => {
    if (Platform.OS === "web") {
      if (window.confirm(t.trash.emptyConfirm)) {
        emptyTrashMut.mutate();
      }
    } else {
      Alert.alert(t.trash.emptyAction, t.trash.emptyConfirm, [
        { text: "Cancelar", style: "cancel" },
        { text: t.trash.emptyAction, style: "destructive", onPress: () => emptyTrashMut.mutate() },
      ]);
    }
  };

  const items = query.data?.items ?? [];

  /** Días que le quedan al elemento antes de la purga definitiva (mín. 1). */
  const daysLeft = (item: TrashItem) =>
    Math.max(
      1,
      Math.ceil((item.deletedAt + TRASH_RETENTION_DAYS * 86_400_000 - Date.now()) / 86_400_000),
    );

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-black" edges={["top", "bottom"]}>
      <View className="px-5 py-4 flex-row items-center justify-between">
        <View className="gap-1 flex-1 pr-3">
          <Text className="text-2xl font-bold text-neutral-900 dark:text-white">
            {t.trash.title}
          </Text>
          <Text className="text-sm text-neutral-500">{t.trash.body}</Text>
        </View>
        {items.length > 0 ? (
          <Button
            size="sm"
            variant="danger"
            label={t.trash.emptyAction}
            loading={emptyTrashMut.isPending}
            onPress={handleEmptyTrash}
          />
        ) : null}
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
                <Text className="text-xs text-neutral-500">{t.trash.daysLeft(daysLeft(item))}</Text>
              </View>
              <View className="min-w-[100px]">
                <Button
                  size="sm"
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
