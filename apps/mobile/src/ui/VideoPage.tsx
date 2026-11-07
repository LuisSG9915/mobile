import { Platform } from "react-native";
import { NativeVideoPlayer } from "./NativeVideoPlayer";
import { WebVideoPlayer } from "./WebVideoPlayer";

export function VideoPage({
  uri,
  previewUri,
  onDownload,
}: {
  uri: string;
  previewUri?: string | null;
  onDownload?: () => void;
}) {
  const primaryUri = previewUri || uri;
  const fallbackUri = previewUri ? uri : null;

  if (Platform.OS === "web") {
    return <WebVideoPlayer uri={primaryUri} fallbackUri={fallbackUri} onDownload={onDownload} />;
  }
  return <NativeVideoPlayer uri={primaryUri} fallbackUri={fallbackUri} />;
}
