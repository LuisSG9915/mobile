import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";

export function NativeVideoPlayer({
  uri,
  fallbackUri,
}: {
  uri: string;
  fallbackUri?: string | null;
}) {
  const [src, setSrc] = useState(uri);

  useEffect(() => {
    setSrc(uri);
  }, [uri]);

  const player = useVideoPlayer(src, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    const sub = player.addListener("statusChange", (payload: { status: string }) => {
      if (payload.status === "error" && fallbackUri && src !== fallbackUri) {
        setSrc(fallbackUri);
      }
    });
    return () => {
      sub.remove();
    };
  }, [player, fallbackUri, src]);

  return (
    <VideoView
      player={player}
      style={{ flex: 1, width: "100%", height: "100%" }}
      contentFit="contain"
      nativeControls
    />
  );
}
