export type TimelineCursor = { t: number; id: string };

export function encodeCursor(c: TimelineCursor): string {
  return btoa(JSON.stringify(c)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(raw: string): TimelineCursor | null {
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(b64));
    if (typeof parsed?.t === "number" && typeof parsed?.id === "string") {
      return { t: parsed.t, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}
