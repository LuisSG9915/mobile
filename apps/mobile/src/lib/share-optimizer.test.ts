import { describe, expect, it } from "vitest";
import {
  calculateScaledDimensions,
  calculateStoriesCrop,
  getPresetConfig,
} from "./share-optimizer-calc";

describe("share-optimizer-calc", () => {
  describe("getPresetConfig", () => {
    it("devuelve la configuración esperada para cada preset", () => {
      const stories = getPresetConfig("stories");
      expect(stories.compressQuality).toBe(0.9);
      expect(stories.filenamePrefix).toBe("historia_1080x1920");
      expect(stories.targetRatio).toBe(9 / 16);

      const fb = getPresetConfig("facebook");
      expect(fb.compressQuality).toBe(0.89);
      expect(fb.maxDimension).toBe(2048);

      const wa = getPresetConfig("whatsapp_hd");
      expect(wa.compressQuality).toBe(0.85);
      expect(wa.maxDimension).toBe(3000);

      const orig = getPresetConfig("original");
      expect(orig.compressQuality).toBe(1.0);
    });
  });

  describe("calculateStoriesCrop", () => {
    it("recorta los laterales en fotos horizontales (4000x3000) para encajar en 9:16", () => {
      // 4000x3000 -> ratio 1.33 > 0.5625
      const crop = calculateStoriesCrop(4000, 3000);
      expect(crop.height).toBe(3000);
      expect(crop.width).toBe(Math.round(3000 * (9 / 16))); // 1688
      expect(crop.originY).toBe(0);
      expect(crop.originX).toBe(Math.round((4000 - 1688) / 2)); // 1156
    });

    it("recorta arriba y abajo en fotos ultra-altas (1000x3000)", () => {
      // 1000x3000 -> ratio 0.33 < 0.5625
      const crop = calculateStoriesCrop(1000, 3000);
      expect(crop.width).toBe(1000);
      expect(crop.height).toBe(Math.round(1000 / (9 / 16))); // 1778
      expect(crop.originX).toBe(0);
      expect(crop.originY).toBe(Math.round((3000 - 1778) / 2)); // 611
    });

    it("mantiene las dimensiones exactas si la foto ya es 9:16 (1080x1920)", () => {
      const crop = calculateStoriesCrop(1080, 1920);
      expect(crop.width).toBe(1080);
      expect(crop.height).toBe(1920);
      expect(crop.originX).toBe(0);
      expect(crop.originY).toBe(0);
    });
  });

  describe("calculateScaledDimensions", () => {
    it("reduce manteniendo relación de aspecto si supera maxDimension (4000x3000 a 2048px)", () => {
      const scaled = calculateScaledDimensions(4000, 3000, 2048);
      expect(scaled.width).toBe(2048);
      expect(scaled.height).toBe(Math.round(3000 * (2048 / 4000))); // 1536
    });

    it("reduce fotos verticales si superan maxDimension (3000x6000 a 3000px)", () => {
      const scaled = calculateScaledDimensions(3000, 6000, 3000);
      expect(scaled.height).toBe(3000);
      expect(scaled.width).toBe(1500);
    });

    it("no modifica fotos que ya están por debajo de maxDimension (1200x800 a 2048px)", () => {
      const scaled = calculateScaledDimensions(1200, 800, 2048);
      expect(scaled.width).toBe(1200);
      expect(scaled.height).toBe(800);
    });
  });
});
