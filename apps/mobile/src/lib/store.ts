import { create } from "zustand";
import { kvGet, kvSet } from "../queue/db";

type Settings = {
  wifiOnly: boolean;
  includeVideos: boolean;
  gridColumns: number;
  onboarded: boolean;
  setWifiOnly: (v: boolean) => void;
  setIncludeVideos: (v: boolean) => void;
  setGridColumns: (v: number) => void;
  setOnboarded: (v: boolean) => void;
};

export const useSettings = create<Settings>((set) => ({
  wifiOnly: kvGet("wifi_only") === "1",
  includeVideos: kvGet("include_videos") !== "0", // default true
  gridColumns: Number(kvGet("grid_columns") ?? "4") || 4,
  onboarded: kvGet("onboarded") === "1",
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
}));
