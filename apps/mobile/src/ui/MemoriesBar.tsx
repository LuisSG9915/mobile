import type { MemoryGroup } from "@photos/shared";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Play, Sparkles, X } from "lucide-react-native";
import { memo, useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../api/client";
import { t } from "../i18n/es";
import { computeStoryStep, resolveTapZone, STORY_DURATION_MS } from "../lib/story-player";

type MemoryModalProps = {
  group: MemoryGroup | null;
  onClose: () => void;
};

function MemoryModal({ group, onClose }: MemoryModalProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [runId, setRunId] = useState(0);
  const progress = useSharedValue(0);
  const kenBurnsScale = useSharedValue(1);
  const currentItem = group?.items[activeStoryIndex] ?? group?.items[0] ?? null;
  const total = group?.items.length ?? 0;

  // Al abrir otra historia, vuelve a la primera diapositiva.
  useEffect(() => {
    if (!group) return;
    setActiveStoryIndex(0);
    setIsPaused(false);
  }, [group?.id]);

  // Cada diapositiva reinicia el Ken Burns y la barra de progreso.
  useEffect(() => {
    progress.value = 0;
    kenBurnsScale.value = 1;
  }, [activeStoryIndex, group?.id, runId, progress, kenBurnsScale]);

  const goTo = useCallback(
    (direction: "next" | "prev") => {
      if (!group) return;
      const step = computeStoryStep(activeStoryIndex, group.items.length, direction);
      if (step.shouldClose) {
        onClose();
        return;
      }
      if (step.nextIndex === activeStoryIndex) {
        // 'prev' en la primera diapositiva: reinicia la historia.
        setRunId((v) => v + 1);
        return;
      }
      setActiveStoryIndex(step.nextIndex);
    },
    [activeStoryIndex, group, onClose],
  );

  useEffect(() => {
    if (!group || total === 0 || !currentItem) return;
    if (isPaused) {
      cancelAnimation(progress);
      cancelAnimation(kenBurnsScale);
      return;
    }
    const remaining = STORY_DURATION_MS * Math.max(0, 1 - progress.value);
    progress.value = withTiming(
      1,
      { duration: Math.max(1, remaining), easing: Easing.linear },
      (finished) => {
        if (finished) runOnJS(goTo)("next");
      },
    );
    kenBurnsScale.value = withTiming(1.06, {
      duration: Math.max(1, remaining),
      easing: Easing.linear,
    });
    return () => {
      cancelAnimation(progress);
      cancelAnimation(kenBurnsScale);
    };
  }, [activeStoryIndex, currentItem, group, isPaused, progress, kenBurnsScale, runId, total, goTo]);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${Math.min(1, progress.value) * 100}%`,
  }));
  const kenBurnsStyle = useAnimatedStyle(() => ({
    transform: [{ scale: kenBurnsScale.value }],
  }));

  if (!group || !currentItem) return null;

  const openCurrent = () => {
    onClose();
    router.push({
      pathname: "/media/[id]",
      params: {
        id: currentItem.id,
        mediaType: currentItem.mediaType,
        durationMs: currentItem.durationMs != null ? String(currentItem.durationMs) : "",
        width: String(currentItem.width),
        height: String(currentItem.height),
        thumbhash: currentItem.thumbhash,
      },
    });
  };

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 bg-black">
        <Animated.View style={[StyleSheet.absoluteFill, kenBurnsStyle]}>
          <Image
            source={{ uri: currentItem.thumbUrl }}
            placeholder={currentItem.thumbhash ? { thumbhash: currentItem.thumbhash } : undefined}
            contentFit="cover"
            style={{ flex: 1 }}
            transition={150}
          />
        </Animated.View>
        <View className="absolute inset-0 bg-black/20" pointerEvents="none" />

        <Pressable
          className="absolute inset-0"
          onPress={(e) => {
            const zone = resolveTapZone(e.nativeEvent.locationX, width);
            goTo(zone);
          }}
          onLongPress={() => setIsPaused(true)}
          onPressOut={() => setIsPaused(false)}
          delayLongPress={250}
          accessibilityLabel={group.title}
        >
          {currentItem.mediaType === "video" ? (
            <View className="flex-1 items-center justify-center" pointerEvents="none">
              <View className="bg-black/50 rounded-full p-4">
                <Play size={32} color="#fff" fill="#fff" />
              </View>
            </View>
          ) : null}
        </Pressable>

        <View
          className="absolute inset-0"
          style={{ opacity: isPaused ? 0 : 1 }}
          pointerEvents={isPaused ? "none" : "box-none"}
        >
          <View style={{ paddingTop: insets.top + 12 }} className="px-4">
            <View className="flex-row gap-1.5">
              {group.items.map((item, idx) => (
                <View
                  key={item.id}
                  className="flex-1 h-0.5 rounded-full overflow-hidden bg-white/30"
                >
                  {idx < activeStoryIndex ? <View className="flex-1 bg-white" /> : null}
                  {idx === activeStoryIndex ? (
                    <Animated.View style={progressStyle} className="h-full bg-white" />
                  ) : null}
                </View>
              ))}
            </View>

            <View className="flex-row items-center justify-between mt-4">
              <View className="flex-1 pr-3">
                <Text className="text-white text-lg font-bold">{group.title}</Text>
                <Text className="text-white/80 text-xs mt-0.5" numberOfLines={1}>
                  {group.date}
                  {currentItem.city ? ` · ${currentItem.city}` : ""}
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={12}
                accessibilityLabel={t.memories.close}
                className="p-1 rounded-full active:bg-white/20"
              >
                <X size={24} color="#fff" />
              </Pressable>
            </View>
          </View>

          <View
            className="absolute left-0 right-0 items-center"
            style={{ bottom: insets.bottom + 24 }}
            pointerEvents="box-none"
          >
            <Pressable
              onPress={openCurrent}
              className="bg-black/60 border border-white/20 rounded-full px-5 py-2.5 active:bg-black/80"
              accessibilityRole="button"
            >
              <Text className="text-white text-sm font-semibold">{t.memories.viewPhoto}</Text>
            </Pressable>
          </View>
        </View>
      </View>
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
