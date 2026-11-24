import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";

const LOADING_TIMEOUT_MS = 10_000;

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
    // Sin esto el video queda parado en el primer fotograma, a veces negro.
    p.play();
  });

  useEffect(() => {
    const switchToFallback = () => {
      if (fallbackUri && src !== fallbackUri) setSrc(fallbackUri);
    };
    const sub = player.addListener(
      "statusChange",
      (payload: { status: string; error?: { message?: string } }) => {
        if (payload.status === "error") {
          console.warn("[video] error de reproducción", { src, error: payload.error?.message });
          switchToFallback();
        }
      },
    );
    // Si se queda cargando (URL lenta o códec que no arranca), probar la otra fuente.
    const timer = setTimeout(() => {
      if (player.status === "loading") switchToFallback();
    }, LOADING_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
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
