import { Image } from "expo-image";
import {
  Copy,
  Globe,
  Info,
  Lightbulb,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Video,
  X,
} from "lucide-react-native";
import { useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { t } from "../i18n/es";
import {
  optimizePhotoForShare,
  type SharePreset,
  saveOptimizedToGallery,
  shareOptimizedMedia,
} from "../lib/share-optimizer";
import { optimizeVideoForShare, saveOptimizedVideoToGallery } from "../lib/video-optimizer";
import { Button } from "./index";

export type ShareMediaModalProps = {
  visible: boolean;
  onClose: () => void;
  media: {
    id: string;
    uri: string;
    thumbUrl?: string;
    thumbhash?: string;
    mediaType: "photo" | "video";
    width: number;
    height: number;
    durationMs?: number | null;
    isLocal?: boolean;
  };
};

type PresetCard = {
  key: SharePreset;
  title: string;
  badge: string;
  desc: string;
  icon: typeof Sparkles;
  highlight?: boolean;
};

export function ShareMediaModal({ visible, onClose, media }: ShareMediaModalProps) {
  const isVideo = media.mediaType === "video";
  const [selectedPreset, setSelectedPreset] = useState<SharePreset>("stories");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [showTips, setShowTips] = useState(true);

  const presets: PresetCard[] = isVideo
    ? [
        {
          key: "stories",
          title: t.shareModal.stories,
          badge: t.shareModal.storiesVideoBadge,
          desc: t.shareModal.storiesVideoDesc,
          icon: Sparkles,
          highlight: true,
        },
        {
          key: "whatsapp_hd",
          title: t.shareModal.whatsappHd,
          badge: t.shareModal.whatsappVideoBadge,
          desc: t.shareModal.whatsappVideoDesc,
          icon: MessageSquare,
        },
        {
          key: "original",
          title: t.shareModal.original,
          badge: t.shareModal.originalBadge,
          desc: t.shareModal.originalDesc,
          icon: ShieldCheck,
        },
      ]
    : [
        {
          key: "stories",
          title: t.shareModal.stories,
          badge: t.shareModal.storiesBadge,
          desc: t.shareModal.storiesDesc,
          icon: Sparkles,
          highlight: true,
        },
        {
          key: "facebook",
          title: t.shareModal.facebook,
          badge: t.shareModal.facebookBadge,
          desc: t.shareModal.facebookDesc,
          icon: Globe,
        },
        {
          key: "whatsapp_hd",
          title: t.shareModal.whatsappHd,
          badge: t.shareModal.whatsappHdBadge,
          desc: t.shareModal.whatsappHdDesc,
          icon: MessageSquare,
        },
        {
          key: "original",
          title: t.shareModal.original,
          badge: t.shareModal.originalBadge,
          desc: t.shareModal.originalDesc,
          icon: ShieldCheck,
        },
      ];

  const handleSaveToGallery = async () => {
    setProcessing(true);
    setProgress(null);
    try {
      if (isVideo) {
        if (selectedPreset === "original") {
          await saveOptimizedVideoToGallery(
            media.uri,
            `video_original_${media.id.slice(0, 8)}.mp4`,
          );
          toast.success(t.shareModal.savedToGallery);
          onClose();
          return;
        }

        setProgress(0);
        const optimized = await optimizeVideoForShare({
          uri: media.uri,
          preset: selectedPreset === "whatsapp_hd" ? "whatsapp_hd" : "stories",
          onProgress: (p) => setProgress(Math.round(p * 100)),
        });

        await saveOptimizedVideoToGallery(optimized.uri, optimized.filename);
        toast.success(t.shareModal.videoSavedToGallery);
        onClose();
        return;
      }

      if (selectedPreset === "original") {
        await saveOptimizedToGallery(media.uri, `original_${media.id.slice(0, 8)}.jpg`);
        toast.success(t.shareModal.savedToGallery);
        onClose();
        return;
      }

      toast.info(t.shareModal.sharing);
      const optimized = await optimizePhotoForShare({
        uri: media.uri,
        width: media.width,
        height: media.height,
        preset: selectedPreset,
      });

      await saveOptimizedToGallery(optimized.uri, optimized.filename);
      toast.success(t.shareModal.savedToGallery);
      onClose();
    } catch (err) {
      console.error("Error al guardar:", err);
      toast.error(t.shareModal.error);
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  };

  const handleShare = async () => {
    setProcessing(true);
    setProgress(null);
    try {
      if (isVideo) {
        if (selectedPreset === "original") {
          await shareOptimizedMedia(media.uri, "Video original", "video/mp4");
          onClose();
          return;
        }

        setProgress(0);
        const optimized = await optimizeVideoForShare({
          uri: media.uri,
          preset: selectedPreset === "whatsapp_hd" ? "whatsapp_hd" : "stories",
          onProgress: (p) => setProgress(Math.round(p * 100)),
        });

        if (Platform.OS !== "web") {
          await saveOptimizedVideoToGallery(optimized.uri, optimized.filename).catch(() => {});
        }

        await shareOptimizedMedia(optimized.uri, "Video optimizado", "video/mp4");
        toast.success(t.shareModal.shared);
        onClose();
        return;
      }

      if (selectedPreset === "original") {
        await shareOptimizedMedia(media.uri, "Foto original", "image/jpeg");
        onClose();
        return;
      }

      toast.info(t.shareModal.sharing);
      const optimized = await optimizePhotoForShare({
        uri: media.uri,
        width: media.width,
        height: media.height,
        preset: selectedPreset,
      });

      if (Platform.OS !== "web") {
        await saveOptimizedToGallery(optimized.uri, optimized.filename).catch(() => {});
      }

      await shareOptimizedMedia(optimized.uri, "Foto optimizada", "image/jpeg");
      toast.success(t.shareModal.shared);
      onClose();
    } catch (err) {
      console.error("Error al compartir:", err);
      toast.error(t.shareModal.error);
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  };

  const handleCopyLink = async () => {
    if (!media.uri.startsWith("http")) {
      toast.info("Este archivo es local en el dispositivo");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(media.uri);
      toast.success(t.shareModal.linkCopied);
      return;
    }
    toast.success(t.shareModal.linkCopied);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/60" onPress={onClose} />
      <SafeAreaView
        edges={["bottom"]}
        className="bg-neutral-900 border-t border-neutral-800 rounded-t-3xl max-h-[90%] w-full max-w-lg self-center"
      >
        {/* Cabecera */}
        <View className="px-5 pt-4 pb-3 border-b border-neutral-800 flex-row items-center justify-between">
          <View>
            <Text className="text-lg font-bold text-white">{t.shareModal.title}</Text>
            <Text className="text-xs text-neutral-400">{t.shareModal.subtitle}</Text>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            className="p-1 rounded-full active:bg-neutral-800"
          >
            <X size={22} color="#9ca3af" />
          </Pressable>
        </View>

        <ScrollView className="px-5 pt-3" showsVerticalScrollIndicator={false}>
          {/* Tarjeta de previsualización del medio */}
          <View className="flex-row items-center gap-3 p-3 mb-4 rounded-2xl bg-neutral-800/80 border border-neutral-700/60">
            <View className="w-14 h-14 rounded-xl overflow-hidden bg-neutral-950 items-center justify-center relative">
              {media.thumbUrl ? (
                <Image
                  source={{ uri: media.thumbUrl }}
                  placeholder={media.thumbhash ? { thumbhash: media.thumbhash } : undefined}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                />
              ) : (
                <Sparkles size={20} color="#6366f1" />
              )}
              {isVideo ? (
                <View className="absolute inset-0 bg-black/40 items-center justify-center">
                  <Video size={18} color="#fff" />
                </View>
              ) : null}
            </View>
            <View className="flex-1">
              <Text className="text-xs font-semibold text-neutral-200">
                {isVideo ? "Video" : "Fotografía"} · {media.width} × {media.height} px
              </Text>
              <Text className="text-[11px] text-neutral-400 mt-0.5">
                {isVideo
                  ? selectedPreset === "stories"
                    ? "Se codificará a 1080p a 9 Mbps H.264 por hardware"
                    : selectedPreset === "whatsapp_hd"
                      ? "Se codificará a 720p HD a 4 Mbps"
                      : "Se enviará el archivo original intacto"
                  : selectedPreset === "stories"
                    ? "Se exportará a 1080 × 1920 (9:16) en sRGB"
                    : selectedPreset === "facebook"
                      ? "Se limitará a 2048 px en sRGB"
                      : selectedPreset === "whatsapp_hd"
                        ? "Se optimizará a 3000 px para modo HD"
                        : "Se enviará el original sin alterar"}
              </Text>
            </View>
          </View>

          {/* Barra de progreso si está codificando video */}
          {progress !== null && processing ? (
            <View className="mb-4 p-3 rounded-2xl bg-indigo-950/60 border border-indigo-500/50 gap-2">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-indigo-300">
                  {t.shareModal.encodingProgress(progress)}
                </Text>
                <Text className="text-xs font-bold text-white">{progress}%</Text>
              </View>
              <View className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
                <View
                  className="h-full bg-indigo-500 rounded-full"
                  style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                />
              </View>
            </View>
          ) : null}

          {/* Lista de perfiles de optimización */}
          <Text className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">
            Perfiles de optimización
          </Text>

          <View className="gap-2.5 mb-4">
            {presets.map((item) => {
              const active = selectedPreset === item.key;
              const IconComp = item.icon;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setSelectedPreset(item.key)}
                  className={`p-3.5 rounded-2xl border transition ${
                    active
                      ? "bg-indigo-950/40 border-indigo-500 shadow-sm"
                      : "bg-neutral-800/60 border-neutral-700/50 active:bg-neutral-800"
                  }`}
                >
                  <View className="flex-row items-start gap-3">
                    <View
                      className={`p-2 rounded-xl ${
                        active ? "bg-indigo-600 text-white" : "bg-neutral-700 text-neutral-300"
                      }`}
                    >
                      <IconComp size={18} color={active ? "#fff" : "#9ca3af"} />
                    </View>

                    <View className="flex-1">
                      <View className="flex-row items-center justify-between mb-1">
                        <Text className="text-sm font-semibold text-white">{item.title}</Text>
                        <View
                          className={`px-2 py-0.5 rounded-md ${
                            active
                              ? "bg-indigo-500/20 border border-indigo-400/40"
                              : "bg-neutral-700/60"
                          }`}
                        >
                          <Text
                            className={`text-[10px] font-bold ${
                              active ? "text-indigo-300" : "text-neutral-400"
                            }`}
                          >
                            {item.badge}
                          </Text>
                        </View>
                      </View>
                      <Text className="text-xs text-neutral-400 leading-relaxed">{item.desc}</Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Bloque informativo de hardware para Videos */}
          {isVideo ? (
            <View className="p-3.5 mb-4 rounded-2xl bg-indigo-950/30 border border-indigo-600/40 gap-1.5">
              <View className="flex-row items-center gap-2">
                <Info size={16} color="#818cf8" />
                <Text className="text-xs font-bold text-indigo-300">
                  {t.shareModal.videoNoteTitle}
                </Text>
              </View>
              <Text className="text-xs text-indigo-200/80 leading-relaxed">
                {t.shareModal.videoNoteDesc}
              </Text>
            </View>
          ) : null}

          {/* Sección desplegable de trucos para el usuario */}
          <View className="mb-4 rounded-2xl bg-neutral-800/60 border border-neutral-700/50 p-3.5 gap-2">
            <Pressable
              onPress={() => setShowTips((prev) => !prev)}
              className="flex-row items-center justify-between"
            >
              <View className="flex-row items-center gap-2">
                <Lightbulb size={16} color="#fbbf24" />
                <Text className="text-xs font-bold text-neutral-200">{t.shareModal.tipsTitle}</Text>
              </View>
              <Text className="text-[11px] text-indigo-400 font-medium">
                {showTips ? "Ocultar" : "Ver trucos"}
              </Text>
            </Pressable>

            {showTips ? (
              <View className="gap-2 pt-2 border-t border-neutral-700/60">
                <Text className="text-[11px] text-neutral-300">
                  • <Text className="font-semibold text-white">Instagram:</Text>{" "}
                  {t.shareModal.tipsInstagram}
                </Text>
                <Text className="text-[11px] text-neutral-300">
                  • <Text className="font-semibold text-white">WhatsApp Estados:</Text>{" "}
                  {t.shareModal.tipsWhatsappStatus}
                </Text>
                <Text className="text-[11px] text-neutral-300">
                  • <Text className="font-semibold text-white">WhatsApp Chats:</Text>{" "}
                  {t.shareModal.tipsWhatsappChat}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Enlace público rápido si es remoto */}
          {!media.isLocal && media.uri.startsWith("http") ? (
            <Pressable
              onPress={handleCopyLink}
              className="flex-row items-center justify-between p-3 mb-4 rounded-2xl bg-neutral-800/40 border border-neutral-700/40 active:bg-neutral-800"
            >
              <View className="flex-row items-center gap-2.5">
                <Copy size={16} color="#a5b4fc" />
                <View>
                  <Text className="text-xs font-semibold text-neutral-200">
                    {t.shareModal.publicLink}
                  </Text>
                  <Text className="text-[11px] text-neutral-400">
                    {t.shareModal.publicLinkDesc}
                  </Text>
                </View>
              </View>
              <Text className="text-xs font-medium text-indigo-400">Copiar</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        {/* Barra de acciones inferior */}
        <View className="p-4 bg-neutral-950 border-t border-neutral-800 flex-row gap-3">
          <View className="flex-1">
            <Button
              variant="secondary"
              label={t.shareModal.saveToGallery}
              loading={processing}
              disabled={processing}
              onPress={handleSaveToGallery}
            />
          </View>
          <View className="flex-1">
            <Button
              label={t.albums.share}
              loading={processing}
              disabled={processing}
              onPress={handleShare}
            />
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
