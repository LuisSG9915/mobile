import { describe, expect, it } from "vitest";
import {
  computeStoryStep,
  isExploreZeroQueryState,
  resolveTapZone,
  STORY_DURATION_MS,
} from "./story-player";

describe("computeStoryStep", () => {
  it("avanza al siguiente índice cuando hay más fotos", () => {
    expect(computeStoryStep(0, 3, "next")).toEqual({ nextIndex: 1, shouldClose: false });
  });

  it("pide cerrar al avanzar desde la última foto", () => {
    expect(computeStoryStep(2, 3, "next")).toEqual({ nextIndex: 2, shouldClose: true });
  });

  it("retrocede sin bajar de 0", () => {
    expect(computeStoryStep(2, 3, "prev")).toEqual({ nextIndex: 1, shouldClose: false });
    expect(computeStoryStep(0, 3, "prev")).toEqual({ nextIndex: 0, shouldClose: false });
  });

  it("cierra si no hay fotos", () => {
    expect(computeStoryStep(0, 0, "next")).toEqual({ nextIndex: 0, shouldClose: true });
  });

  it("expone una duración de 4 segundos", () => {
    expect(STORY_DURATION_MS).toBe(4000);
  });
});

describe("resolveTapZone", () => {
  it("retrocede en el tercio izquierdo", () => {
    expect(resolveTapZone(10, 300)).toBe("prev");
    expect(resolveTapZone(98, 300)).toBe("prev");
  });

  it("avanza en los dos tercios derechos", () => {
    expect(resolveTapZone(100, 300)).toBe("next");
    expect(resolveTapZone(299, 300)).toBe("next");
  });

  it("avanza si el ancho no es válido", () => {
    expect(resolveTapZone(10, 0)).toBe("next");
  });
});

describe("isExploreZeroQueryState", () => {
  const empty = {
    debouncedSearch: "",
    selectedMediaType: null,
    selectedTag: null,
    selectedCountry: null,
    selectedCity: null,
    dateRange: "all",
  };

  it("devuelve true sin texto ni filtros", () => {
    expect(isExploreZeroQueryState(empty)).toBe(true);
    expect(isExploreZeroQueryState({ ...empty, debouncedSearch: "   " })).toBe(true);
  });

  it.each([
    ["texto", { debouncedSearch: "xalapa" }],
    ["tipo", { selectedMediaType: "photos" }],
    ["tag", { selectedTag: "playa" }],
    ["país", { selectedCountry: "México" }],
    ["ciudad", { selectedCity: "Xalapa" }],
    ["fecha", { dateRange: "month" }],
  ])("devuelve false con %s activo", (_label, patch) => {
    expect(isExploreZeroQueryState({ ...empty, ...patch })).toBe(false);
  });
});
