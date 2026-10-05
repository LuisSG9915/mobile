export const thumbKey = (userId: string, sha256: string) => `users/${userId}/thumbs/${sha256}.webp`;

export const originalKey = (userId: string, sha256: string, ext: string) =>
  `users/${userId}/originals/${sha256}.${ext}`;
