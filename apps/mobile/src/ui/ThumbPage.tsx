import { Image } from "expo-image";
import type { CarouselItem } from "./viewer-types";

export function ThumbPage({ item }: { item: CarouselItem }) {
  return (
    <Image
      source={{ uri: item.thumbUrl }}
      placeholder={item.thumbhash ? { thumbhash: item.thumbhash } : undefined}
      contentFit="contain"
      style={{ flex: 1, width: "100%", height: "100%" }}
      transition={150}
    />
  );
}
