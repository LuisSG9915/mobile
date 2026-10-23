import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRetryFailed = vi.fn(async () => {});
const mockProcessQueue = vi.fn(async () => {});
let mockPaused = false;

vi.mock("./db", () => ({
  retryFailed: () => mockRetryFailed(),
  isBackupPaused: () => mockPaused,
}));

vi.mock("./processor", () => ({
  processQueue: () => mockProcessQueue(),
}));

vi.mock("./scanner", () => ({
  scanLibrary: vi.fn(async () => {}),
}));

describe("initNetworkAutoResume (web)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPaused = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("llama a retryFailed y runBackupPass al dispararse el evento online", async () => {
    const { initNetworkAutoResume } = await import("./runner.web");
    const cleanup = initNetworkAutoResume();

    window.dispatchEvent(new Event("online"));

    await vi.waitFor(() => {
      expect(mockRetryFailed).toHaveBeenCalledTimes(1);
      expect(mockProcessQueue).toHaveBeenCalledTimes(1);
    });

    cleanup();
  });

  it("no reanuda si el respaldo está pausado manualmente", async () => {
    mockPaused = true;
    const { initNetworkAutoResume } = await import("./runner.web");
    const cleanup = initNetworkAutoResume();

    window.dispatchEvent(new Event("online"));

    await new Promise((r) => setTimeout(r, 50));
    expect(mockRetryFailed).not.toHaveBeenCalled();
    expect(mockProcessQueue).not.toHaveBeenCalled();

    cleanup();
  });

  it("deja de escuchar al invocar la función cleanup", async () => {
    const { initNetworkAutoResume } = await import("./runner.web");
    const cleanup = initNetworkAutoResume();
    cleanup();

    window.dispatchEvent(new Event("online"));

    await new Promise((r) => setTimeout(r, 50));
    expect(mockRetryFailed).not.toHaveBeenCalled();
    expect(mockProcessQueue).not.toHaveBeenCalled();
  });
});
