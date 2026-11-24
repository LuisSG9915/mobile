import { describe, expect, it } from "vitest";
import { dateFromFilename } from "./filename-date";

const NOW = Date.UTC(2026, 10, 24, 15, 0, 0);
const wall = (y: number, mo: number, d: number, h = 12, mi = 0, s = 0) =>
  Date.UTC(y, mo - 1, d, h, mi, s);

describe("dateFromFilename", () => {
  it("cámara Android con hora", () => {
    expect(dateFromFilename("IMG_20261120_203012.jpg", NOW)).toBe(wall(2026, 11, 20, 20, 30, 12));
    expect(dateFromFilename("PXL_20261120_203012345.jpg", NOW)).toBe(
      wall(2026, 11, 20, 20, 30, 12),
    );
  });
  it("WhatsApp sin hora usa mediodía", () => {
    expect(dateFromFilename("IMG-20261118-WA0003.jpg", NOW)).toBe(wall(2026, 11, 18));
    expect(dateFromFilename("VID-20261118-WA0001.mp4", NOW)).toBe(wall(2026, 11, 18));
  });
  it("capturas de pantalla", () => {
    expect(dateFromFilename("Screenshot_2026-11-20-20-30-12.png", NOW)).toBe(
      wall(2026, 11, 20, 20, 30, 12),
    );
    expect(dateFromFilename("Screenshot_20261120-203012.png", NOW)).toBe(
      wall(2026, 11, 20, 20, 30, 12),
    );
  });
  it("descarta nombres sin fecha, fechas imposibles y futuras", () => {
    expect(dateFromFilename("7699613812277677344_original.mp4", NOW)).toBeNull();
    expect(dateFromFilename("restore-57fde3c1e4e0637a.jpg", NOW)).toBeNull();
    expect(dateFromFilename("IMG_20260231_101010.jpg", NOW)).toBeNull();
    expect(dateFromFilename("IMG_20301231_101010.jpg", NOW)).toBeNull();
    expect(dateFromFilename(null, NOW)).toBeNull();
  });
  it("hora inválida cae a mediodía de ese día", () => {
    expect(dateFromFilename("IMG_20261120_996677.jpg", NOW)).toBe(wall(2026, 11, 20));
  });
});
