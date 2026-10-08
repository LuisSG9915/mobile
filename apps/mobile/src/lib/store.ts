import { type TimelineFilter, timelineFilterSchema } from "@photos/shared";
import { create } from "zustand";
import { kvGet, kvSet } from "../queue/db";
import type { SyncProgressState } from "../queue/types";

const storedFilter = (): TimelineFilter => {
  const v = kvGet("timeline_filter");
  return timelineFilterSchema.options.includes(v as TimelineFilter) ? (v as TimelineFilter) : "all";
};

export type AlbumFilter =
  | { type: "remote"; albumId: string; title: string }
  | { type: "local"; albumId: string; title: string };

const storedSyncedAlbumIds = (): string[] | null => {
  const v = kvGet("synced_album_ids");
  if (!v || v === "ALL") return null;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

type Settings = {
  wifiOnly: boolean;
  includeVideos: boolean;
  gridColumns: number;
  onboarded: boolean;
  timelineFilter: TimelineFilter;
  albumFilter: AlbumFilter | null;
  syncedAlbumIds: string[] | null;
  setWifiOnly: (v: boolean) => void;
  setIncludeVideos: (v: boolean) => void;
  setGridColumns: (v: number) => void;
  setOnboarded: (v: boolean) => void;
  setTimelineFilter: (v: TimelineFilter) => void;
  setAlbumFilter: (v: AlbumFilter | null) => void;
  setSyncedAlbumIds: (ids: string[] | null) => void;
  isAlbumSynced: (albumId: string) => boolean;
  toggleAlbumSync: (albumId: string, allAvailableIds?: string[]) => void;
  syncAllAlbums: () => void;
  syncNoAlbums: () => void;
};

export const useSettings = create<Settings>((set, get) => ({
  wifiOnly: kvGet("wifi_only") === "1",
  includeVideos: kvGet("include_videos") !== "0", // default true
  gridColumns: Number(kvGet("grid_columns") ?? "3") || 3, // default = densidad "normal" del pinch
  onboarded: kvGet("onboarded") === "1",
  timelineFilter: storedFilter(),
  albumFilter: null,
  syncedAlbumIds: storedSyncedAlbumIds(),
  setWifiOnly: (v) => {
    kvSet("wifi_only", v ? "1" : "0");
    set({ wifiOnly: v });
  },
  setIncludeVideos: (v) => {
    kvSet("include_videos", v ? "1" : "0");
    set({ includeVideos: v });
  },
  setGridColumns: (v) => {
    kvSet("grid_columns", String(v));
    set({ gridColumns: v });
  },
  setOnboarded: (v) => {
    kvSet("onboarded", v ? "1" : "0");
    set({ onboarded: v });
  },
  setTimelineFilter: (v) => {
    kvSet("timeline_filter", v);
    set({ timelineFilter: v });
  },
  setAlbumFilter: (v) => {
    set({ albumFilter: v });
  },
  setSyncedAlbumIds: (ids) => {
    kvSet("synced_album_ids", ids === null ? "ALL" : JSON.stringify(ids));
    set({ syncedAlbumIds: ids });
  },
  isAlbumSynced: (albumId) => {
    const list = get().syncedAlbumIds;
    if (list === null) return true;
    return list.includes(albumId);
  },
  toggleAlbumSync: (albumId, allAvailableIds = []) => {
    const current = get().syncedAlbumIds;
    let next: string[];
    if (current === null) {
      next = allAvailableIds.filter((id) => id !== albumId);
    } else if (current.includes(albumId)) {
      next = current.filter((id) => id !== albumId);
    } else {
      next = [...current, albumId];
    }
    kvSet("synced_album_ids", JSON.stringify(next));
    set({ syncedAlbumIds: next });
  },
  syncAllAlbums: () => {
    kvSet("synced_album_ids", "ALL");
    set({ syncedAlbumIds: null });
  },
  syncNoAlbums: () => {
    kvSet("synced_album_ids", JSON.stringify([]));
    set({ syncedAlbumIds: [] });
  },
}));

/**
 * Estado reactivo del respaldo (anillo del avatar, barra de Respaldo). Lo
 * alimentan los procesadores vía publishSyncProgress y useSyncProgressAuto
 * refresca ante cualquier tick de la cola.
 */
export const useSyncProgress = create<
  SyncProgressState & { update: (s: SyncProgressState) => void }
>((set) => ({
  bytesUploaded: 0,
  totalBytes: 0,
  filesTotal: 0,
  filesRemaining: 0,
  currentFileName: "",
  status: "idle",
  update: (s) => set(s),
}));
