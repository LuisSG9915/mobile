import type { MemoryGroup } from "@photos/shared";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Heart, Play, Sparkles, X } from "lucide-react-native";
import { memo, useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import { t } from "../i18n/es";
import { formatDuration } from "../lib/format";

type MemoryModalProps = {
  group: MemoryGroup | null;
  onClose: () => void;
};

function MemoryModal({ group, onClose }: MemoryModalProps) {
  if (!group) return null;

  return (
    <Modal visible={!!group} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-white dark:bg-neutral-900">
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <View>
            <Text className="text-xl font-bold text-neutral-900 dark:text-white">
              {group.title}
            </Text>
            <Text className="text-xs text-neutral-500 dark:text-neutral-400">
              {group.date} · {t.memories.photosCount(group.items.length)}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityLabel={t.memories.close}
            className="p-1 rounded-full active:bg-neutral-100 dark:active:bg-neutral-800"
          >
            <X size={24} color="#737373" />
          </Pressable>
        </View>

        <FlatList
          data={group.items}
          keyExtractor={(item) => item.id}
          numColumns={3}
          contentContainerStyle={{ padding: 2 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                onClose();
                router.push({
                  pathname: "/media/[id]",
                  params: {
                    id: item.id,
                    mediaType: item.mediaType,
                    durationMs: item.durationMs != null ? String(item.durationMs) : "",
                    width: String(item.width),
                    height: String(item.height),
                    thumbhash: item.thumbhash,
                  },
                });
              }}
              style={{ flex: 1 / 3, aspectRatio: 1, padding: 2 }}
            >
              <Image
                source={{ uri: item.thumbUrl }}
                placeholder={item.thumbhash ? { thumbhash: item.thumbhash } : undefined}
                contentFit="cover"
                style={{ width: "100%", height: "100%", borderRadius: 6 }}
              />
              {item.mediaType === "video" ? (
                <View className="absolute bottom-2 right-2 flex-row items-center bg-black/60 rounded px-1.5 py-0.5 gap-1">
                  <Play size={10} color="#fff" />
                  <Text className="text-white text-[10px] font-medium">
                    {formatDuration(item.durationMs) ?? ""}
                  </Text>
                </View>
              ) : null}
              {item.isFavorite ? (
                <View className="absolute bottom-2 left-2 bg-black/50 rounded-full p-1 shadow-sm">
                  <Heart size={12} color="#f43f5e" fill="#f43f5e" />
                </View>
              ) : null}
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

export const MemoriesBar = memo(function MemoriesBar() {
  const [selectedGroup, setSelectedGroup] = useState<MemoryGroup | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["memories"],
    queryFn: () => api.memories(),
    staleTime: 5 * 60_000,
  });

  const memories = data?.memories ?? [];
  if (isLoading || memories.length === 0) {
    return null;
  }

  return (
    <View className="mb-3 px-4">
      <View className="flex-row items-center gap-1.5 mb-2">
        <Sparkles size={16} color="#6366f1" />
        <Text className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
          {t.memories.onThisDay}
        </Text>
      </View>
      <FlatList
        data={memories}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: 10 }}
        renderItem={({ item }) => {
          const cover = item.items[0];
          return (
            <Pressable
              onPress={() => setSelectedGroup(item)}
              accessibilityLabel={`${item.title}, ${item.date}`}
              className="relative w-28 h-36 rounded-2xl overflow-hidden bg-neutral-200 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 shadow-sm active:scale-95 transition-transform"
            >
              {cover ? (
                <Image
                  source={{ uri: cover.thumbUrl }}
                  placeholder={cover.thumbhash ? { thumbhash: cover.thumbhash } : undefined}
                  contentFit="cover"
                  style={{ width: "100%", height: "100%" }}
                />
              ) : null}
              {/* Degradado oscuro inferior para legibilidad del texto */}
              <View className="absolute inset-0 bg-black/35 justify-between p-2">
                <View className="self-end bg-black/50 px-1.5 py-0.5 rounded-full">
                  <Text className="text-[10px] text-white font-medium">{item.items.length}</Text>
                </View>
                <View>
                  <Text className="text-white text-xs font-bold shadow-sm">{item.title}</Text>
                  <Text className="text-white/80 text-[10px] font-medium">
                    {item.date.slice(0, 4)}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
      <MemoryModal group={selectedGroup} onClose={() => setSelectedGroup(null)} />
    </View>
  );
});
