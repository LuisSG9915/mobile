import type { ScanOptions, ScanResult } from "./types";

export type { ScanOptions, ScanResult } from "./types";

export async function scanLibrary(_opts: ScanOptions = {}): Promise<ScanResult> {
  return { added: 0, skipped: 0 };
}
