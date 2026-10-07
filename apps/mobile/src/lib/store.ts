import { type TimelineFilter, timelineFilterSchema } from "@photos/shared";
import { create } from "zustand";
import { kvGet, kvSet } from "../queue/db";
import type { SyncProgressState } from "../queue/types";

const storedFilter = (): TimelineFilter => {
  const v = kvGet("timeline_filter");
  return timelineFilterSchema.options.includes(v as TimelineFilter) ? (v as TimelineFilter) : "all";
};

type Settings = {
  wifiOnly: boolean;
  includeVideos: boolean;
  gridColumns: number;
  onboarded: boolean;
  timelineFilter: TimelineFilter;
  setWifiOnly: (v: boolean) => void;
  setIncludeVideos: (v: boolean) => void;
  setGridColumns: (v: number) => void;
  setOnboarded: (v: boolean) => void;
  setTimelineFilter: (v: TimelineFilter) => void;
};

export const useSettings = create<Settings>((set) => ({
  wifiOnly: kvGet("wifi_only") === "1",
  includeVideos: kvGet("include_videos") !== "0", // default true
  gridColumns: Number(kvGet("grid_columns") ?? "4") || 4,
  onboarded: kvGet("onboarded") === "1",
  timelineFilter: storedFilter(),
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
