import { Image } from "expo-image";
import { RotateCw, X } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { t } from "../i18n/es";
import { type AspectRatioOption, processAndSaveEditedPhoto } from "../lib/image-editor";
import { Button } from "./index";

type PhotoEditorModalProps = {
  visible: boolean;
  uri: string;
  width: number;
  height: number;
  onClose: () => void;
  onSaved?: () => void;
};

const ASPECT_RATIOS: { key: AspectRatioOption; label: string }[] = [
  { key: "original", label: t.editor.ratioOriginal },
  { key: "1:1", label: t.editor.ratioSquare },
  { key: "4:3", label: t.editor.ratio4_3 },
  { key: "16:9", label: t.editor.ratio16_9 },
];

export function PhotoEditorModal({
  visible,
  uri,
  width: originalW,
  height: originalH,
  onClose,
  onSaved,
}: PhotoEditorModalProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const [rotationDegrees, setRotationDegrees] = useState(0);
  const [selectedRatio, setSelectedRatio] = useState<AspectRatioOption>("original");
  const [saving, setSaving] = useState(false);

  const handleRotate = () => {
    setRotationDegrees((prev) => (prev + 90) % 360);
  };

  const handleReset = () => {
    setRotationDegrees(0);
    setSelectedRatio("original");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await processAndSaveEditedPhoto({
        uri,
        rotationDegrees,
        aspectRatio: selectedRatio,
        imageWidth: originalW,
        imageHeight: originalH,
      });
      toast.success(t.editor.saved);
      onSaved?.();
      onClose();
    } catch (err) {
      console.error("Error al guardar foto editada", err);
      toast.error(t.auth.genericError);
    } finally {
      setSaving(false);
    }
  };

  // Dimensiones del visor de previsualización
  const previewMaxW = windowWidth - 32;
  const previewMaxH = windowHeight * 0.55;

  const isRotated90or270 = rotationDegrees % 180 !== 0;
  const currentRatio = isRotated90or270 ? originalH / originalW : originalW / originalH;

  let targetRatio = currentRatio;
  if (selectedRatio === "1:1") targetRatio = 1;
  else if (selectedRatio === "4:3") targetRatio = 4 / 3;
  else if (selectedRatio === "16:9") targetRatio = 16 / 9;

  let boxW = previewMaxW;
  let boxH = previewMaxW / targetRatio;
  if (boxH > previewMaxH) {
    boxH = previewMaxH;
    boxW = previewMaxH * targetRatio;
  }

  const isModified = rotationDegrees !== 0 || selectedRatio !== "original";

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-black" edges={["top", "bottom"]}>
        {/* Encabezado */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-neutral-800">
          <Pressable
            onPress={onClose}
            disabled={saving}
            hitSlop={12}
            className="p-1 rounded-full active:bg-neutral-800"
          >
            <X size={24} color="#fff" />
          </Pressable>

          <Text className="text-base font-semibold text-white">{t.editor.title}</Text>

          <Button
            size="sm"
            label={t.editor.save}
            loading={saving}
            disabled={!isModified || saving}
            onPress={handleSave}
          />
        </View>

        {/* Área de Previsualización */}
        <View className="flex-1 items-center justify-center p-4">
          <View
            style={{
              width: boxW,
              height: boxH,
              overflow: "hidden",
              borderRadius: 8,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.2)",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#111",
            }}
          >
            <Image
              source={{ uri }}
              style={{
                width: isRotated90or270 ? boxH : boxW,
                height: isRotated90or270 ? boxW : boxH,
                transform: [{ rotate: `${rotationDegrees}deg` }],
              }}
              contentFit="cover"
            />
          </View>
        </View>

        {/* Barra de Herramientas Inferior */}
        <View className="p-4 bg-neutral-900 border-t border-neutral-800 gap-4">
          {/* Selector de relación de aspecto / recorte */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}
          >
            {ASPECT_RATIOS.map((item) => {
              const active = selectedRatio === item.key;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setSelectedRatio(item.key)}
                  className={`px-3 py-1.5 rounded-full border ${
                    active ? "bg-accent border-accent" : "bg-neutral-800 border-neutral-700"
                  }`}
                >
                  <Text
                    className={`text-xs font-semibold ${
                      active ? "text-white" : "text-neutral-300"
                    }`}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Acciones principales: Rotar y Restablecer */}
          <View className="flex-row items-center justify-around pt-2 border-t border-neutral-800/80">
            <Pressable
              onPress={handleRotate}
              className="flex-row items-center gap-2 px-4 py-2 rounded-xl bg-neutral-800 active:bg-neutral-700"
            >
              <RotateCw size={18} color="#fff" />
              <Text className="text-sm font-medium text-white">{t.editor.rotate}</Text>
            </Pressable>

            {isModified ? (
              <Pressable
                onPress={handleReset}
                className="px-4 py-2 rounded-xl active:bg-neutral-800"
              >
                <Text className="text-sm font-medium text-neutral-400">{t.editor.reset}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
