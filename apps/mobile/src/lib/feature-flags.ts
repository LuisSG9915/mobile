import { kvGet, kvSet } from "../queue/db";

export const UPLOAD_STRATEGY_V2_KEY = "upload_strategy_v2";

/** Lee el flag (default off). */
export function isUploadStrategyV2Enabled(): boolean {
  return kvGet(UPLOAD_STRATEGY_V2_KEY) === "true";
}

/** Escribe el flag. */
export function setUploadStrategyV2Enabled(enabled: boolean): void {
  kvSet(UPLOAD_STRATEGY_V2_KEY, enabled ? "true" : "false");
}
