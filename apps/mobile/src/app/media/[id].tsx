import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { Info, Trash2, X } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { api } from "../../api/client";
import { t } from "../../i18n/es";
import { formatBytes, formatDateTime } from "../../lib/format";
import { Button } from "../../ui";

function ZoomableImage({ uri, thumbhash }: { uri: string; thumbhash: string }) {
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(5, saved.value * e.scale));
    })
    .onEnd(() => {
      saved.value = scale.value;
      if (scale.value <= 1) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .onUpdate((e) => {
      if (saved.value > 1) {
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const next = saved.value > 1 ? 1 : 2.5;
      saved.value = next;
      scale.value = withTiming(next);
      if (next === 1) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <Animated.View style={[{ flex: 1 }, style]}>
        <Image
          source={{ uri }}
          placeholder={{ thumbhash }}
          contentFit="contain"
          style={{ flex: 1 }}
          transition={150}
        />
      </Animated.View>
    </GestureDetector>
  );
}

function VideoPage({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />;
}

export default function MediaViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [showInfo, setShowInfo] = useState(false);
  const detail = useQuery({
    queryKey: ["media", id],
    queryFn: () => api.mediaDetail(id),
    enabled: !!id,
  });

  const del = useMutation({
    mutationFn: api.deleteMedia,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["timeline"] });
      void qc.invalidateQueries({ queryKey: ["trash"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      toast(t.viewer.movedToTrash, {
        action: {
          label: t.viewer.undo,
          onClick: () =>
            void api.restoreMedia(id).then(() => {
              void qc.invalidateQueries({ queryKey: ["timeline"] });
              void qc.invalidateQueries({ queryKey: ["trash"] });
              void qc.invalidateQueries({ queryKey: ["stats"] });
            }),
        },
      });
      router.back();
    },
  });

  const d = detail.data;

  return (
    <SafeAreaView className="flex-1 bg-black" edges={["top", "bottom"]}>
      <View className="flex-row justify-between px-4 py-2 z-10">
        <Pressable onPress={() => router.back()} accessibilityLabel="cerrar" hitSlop={12}>
          <X color="#fff" size={26} />
        </Pressable>
        <View className="flex-row gap-5">
          <Pressable
            onPress={() => setShowInfo(true)}
            accessibilityLabel={t.viewer.info}
            hitSlop={12}
          >
            <Info color="#fff" size={24} />
          </Pressable>
          <Pressable
            onPress={() => del.mutate(id)}
            accessibilityLabel={t.viewer.moveToTrash}
            hitSlop={12}
          >
            <Trash2 color="#fff" size={24} />
          </Pressable>
        </View>
      </View>

      <View className="flex-1">
        {detail.isPending ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#fff" />
          </View>
        ) : !d ? (
          <View className="flex-1 items-center justify-center">
            <Text className="text-neutral-400">No encontrado</Text>
          </View>
        ) : d.mediaType === "video" ? (
          <VideoPage uri={d.originalUrl} />
        ) : (
          <ZoomableImage uri={d.originalUrl} thumbhash={d.thumbhash} />
        )}
      </View>

      <Modal
        visible={showInfo}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInfo(false)}
      >
        <Pressable className="flex-1 bg-black/40" onPress={() => setShowInfo(false)} />
        <View className="bg-white dark:bg-neutral-900 rounded-t-3xl px-6 pt-4 pb-10">
          <View className="w-10 h-1.5 rounded-full bg-neutral-300 self-center mb-4" />
          <Text className="text-xl font-bold text-neutral-900 dark:text-white mb-4">
            {t.viewer.info}
          </Text>
          {d ? (
            <ScrollView className="gap-3 max-h-80">
              <InfoRow label={t.viewer.date} value={formatDateTime(d.takenAt)} />
              <InfoRow label={t.viewer.size} value={formatBytes(d.fileSize)} />
              <InfoRow label={t.viewer.type} value={d.mimeType} />
              {d.latitude != null && d.longitude != null ? (
                <InfoRow
                  label={t.viewer.location}
                  value={`${d.latitude.toFixed(4)}, ${d.longitude.toFixed(4)}`}
                />
              ) : null}
              <View className="mt-2">
                <Button
                  label={t.viewer.moveToTrash}
                  variant="danger"
                  onPress={() => {
                    setShowInfo(false);
                    del.mutate(d.id);
                  }}
                />
              </View>
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2 border-b border-neutral-100 dark:border-neutral-800">
      <Text className="text-sm text-neutral-500">{label}</Text>
      <Text className="text-sm font-medium text-neutral-900 dark:text-white">{value}</Text>
    </View>
  );
}
