import { Platform } from "react-native";
import { videoSources } from "../lib/video-source";
import { NativeVideoPlayer } from "./NativeVideoPlayer";
import { WebVideoPlayer } from "./WebVideoPlayer";

export function VideoPage({
  uri,
  previewUri,
  onDownload,
  isActive = true,
}: {
  uri: string;
  previewUri?: string | null;
  onDownload?: () => void;
  isActive?: boolean;
}) {
  const { primary: primaryUri, fallback: fallbackUri } = videoSources(uri, previewUri);

  if (Platform.OS === "web") {
    return <WebVideoPlayer uri={primaryUri} fallbackUri={fallbackUri} onDownload={onDownload} />;
  }
  if (!isActive) return null;
  return <NativeVideoPlayer uri={primaryUri} fallbackUri={fallbackUri} />;
}
