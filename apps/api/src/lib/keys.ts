export const thumbKey = (userId: string, sha256: string) => `users/${userId}/thumbs/${sha256}.webp`;

export const previewKey = (
  userId: string,
  sha256: string,
  mediaType: "photo" | "video" = "photo",
) => `users/${userId}/previews/${sha256}.${mediaType === "video" ? "mp4" : "webp"}`;

export const originalKey = (userId: string, sha256: string, ext: string) =>
  `users/${userId}/originals/${sha256}.${ext}`;
