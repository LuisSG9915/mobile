import { Download } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

export function WebVideoPlayer({
  uri,
  fallbackUri,
  onDownload,
}: {
  uri: string;
  fallbackUri?: string | null;
  onDownload?: () => void;
}) {
  const [currentSrc, setCurrentSrc] = useState(uri);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setCurrentSrc(uri);
    setHasError(false);
  }, [uri]);

  const handleError = () => {
    if (fallbackUri && currentSrc !== fallbackUri) {
      setCurrentSrc(fallbackUri);
    } else {
      setHasError(true);
    }
  };

  if (hasError) {
    return (
      <View
        style={{
          flex: 1,
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Text style={{ color: "#e5e5e5", fontSize: 16, marginBottom: 16, textAlign: "center" }}>
          Tu navegador no soporta la reproducción directa de este formato/códec de video.
        </Text>
        {onDownload ? (
          <Pressable
            onPress={onDownload}
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: "#2563eb",
              paddingHorizontal: 20,
              paddingVertical: 12,
              borderRadius: 12,
            }}
            accessibilityRole="button"
          >
            <Download size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>
              Descargar video original
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: videos personales subidos por el usuario */}
      <video
        src={currentSrc}
        controls
        autoPlay
        playsInline
        onError={handleError}
        style={{
          maxWidth: "100%",
          maxHeight: "80vh",
          width: "auto",
          height: "auto",
          objectFit: "contain",
        }}
      />
    </View>
  );
}
