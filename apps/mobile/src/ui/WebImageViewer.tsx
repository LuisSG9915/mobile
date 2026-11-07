import { Image } from "expo-image";
import { View } from "react-native";

export function WebImageViewer({
  uri,
  thumbUrl,
  thumbhash,
}: {
  uri?: string | null;
  thumbUrl?: string | null;
  thumbhash?: string | null;
}) {
  const displayUri = uri || thumbUrl;
  return (
    <View
      style={{
        flex: 1,
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      {displayUri ? (
        <Image
          source={{ uri: displayUri }}
          placeholder={thumbhash ? { thumbhash } : undefined}
          style={{
            maxWidth: "100%",
            maxHeight: "85%",
            width: "100%",
            height: "100%",
          }}
          contentFit="contain"
          transition={150}
        />
      ) : null}
    </View>
  );
}
