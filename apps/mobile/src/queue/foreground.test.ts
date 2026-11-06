import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncProgressState } from "./types";

const h = vi.hoisted(() => ({
  state: {
    bytesUploaded: 30,
    totalBytes: 100,
    filesTotal: 10,
    filesRemaining: 7,
    currentFileName: "IMG_1.jpg",
    currentPhase: "uploading_original",
    bytesPerSecond: 0,
    etaSeconds: null,
    status: "syncing",
  } satisfies SyncProgressState,
  appState: { currentState: "active" as string },
  native: {
    start: vi.fn(
      async (
        _title: string,
        _body: string,
        _percent: number,
        _timeoutTitle: string,
        _timeoutBody: string,
      ) => {},
    ),
    update: vi.fn(async (_title: string, _body: string, _percent: number) => {}),
    stop: vi.fn(async () => {}),
    isRunning: vi.fn(() => true),
    addListener: vi.fn((_event: string, _listener: () => void) => ({ remove: vi.fn() })),
  },
}));

vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: () => h.native,
}));

vi.mock("react-native", () => ({ AppState: h.appState }));

vi.mock("../lib/store", () => ({
  useSyncProgress: { getState: () => h.state },
}));

type Foreground = typeof import("./foreground");

async function load(): Promise<Foreground> {
  vi.resetModules();
  // @ts-expect-error -- ruta con extensión para saltar la resolución *.web.ts
  return await import("./foreground.ts");
}

describe("foreground (Android)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    h.appState.currentState = "active";
    h.state = {
      ...h.state,
      bytesUploaded: 30,
      filesTotal: 10,
      filesRemaining: 7,
      status: "syncing",
    };
    for (const fn of Object.values(h.native)) fn.mockClear();
    h.native.isRunning.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("arranca el servicio con el progreso actual", async () => {
    const fg = await load();
    fg.startUploadForeground();
    expect(h.native.start).toHaveBeenCalledTimes(1);
    const [title, body, percent, timeoutTitle, timeoutBody] = h.native.start.mock.calls[0];
    expect(title).toBe("Respaldando fotos y videos");
    expect(body).toContain("3 de 10");
    expect(percent).toBe(30);
    expect(timeoutTitle).toBe("Respaldo pausado");
    expect(timeoutBody).toContain("6 h");
  });

  it("throttlea las actualizaciones a una por segundo", async () => {
    const fg = await load();
    fg.startUploadForeground();

    fg.updateUploadForeground({ ...h.state, bytesUploaded: 40 });
    expect(h.native.update).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    fg.updateUploadForeground({ ...h.state, bytesUploaded: 60 });
    expect(h.native.update).toHaveBeenCalledTimes(1);
    expect(h.native.update.mock.calls[0][2]).toBe(60);
  });

  it("para el servicio una sola vez", async () => {
    const fg = await load();
    fg.startUploadForeground();
    fg.stopUploadForeground();
    fg.stopUploadForeground();
    expect(h.native.stop).toHaveBeenCalledTimes(1);
  });

  it("avisa del timeout y permite desuscribirse", async () => {
    const fg = await load();
    const handler = vi.fn();
    const off = fg.onUploadForegroundTimeout(handler);
    expect(h.native.addListener).toHaveBeenCalledWith("onTimeout", expect.any(Function));

    const listener = h.native.addListener.mock.calls[0][1] as () => void;
    listener();
    expect(handler).toHaveBeenCalledTimes(1);

    off();
    expect(h.native.addListener.mock.results[0].value.remove).toHaveBeenCalled();
  });

  it("no reintenta en bucle si el SO rechaza arrancar en segundo plano", async () => {
    h.appState.currentState = "background";
    h.native.start.mockRejectedValueOnce(new Error("ForegroundServiceStartNotAllowed"));
    const fg = await load();

    fg.startUploadForeground();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.native.start).toHaveBeenCalledTimes(1);

    fg.startUploadForeground();
    expect(h.native.start).toHaveBeenCalledTimes(1);
  });
});
