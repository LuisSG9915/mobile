export const STORY_DURATION_MS = 4000;

export interface StoryStepResult {
  nextIndex: number;
  shouldClose: boolean;
}

/** Avanza/retrocede dentro de una historia; en la última, pide cerrar. */
export function computeStoryStep(
  currentIndex: number,
  total: number,
  direction: "next" | "prev",
): StoryStepResult {
  if (total <= 0) {
    return { nextIndex: 0, shouldClose: true };
  }
  if (direction === "next") {
    if (currentIndex + 1 < total) {
      return { nextIndex: currentIndex + 1, shouldClose: false };
    }
    return { nextIndex: currentIndex, shouldClose: true };
  }
  return {
    nextIndex: Math.max(0, currentIndex - 1),
    shouldClose: false,
  };
}

/** Tercio izquierdo retrocede; el resto avanza. */
export function resolveTapZone(locationX: number, containerWidth: number): "prev" | "next" {
  if (containerWidth <= 0) return "next";
  return locationX < containerWidth * 0.33 ? "prev" : "next";
}

export interface ExploreQueryStateInput {
  debouncedSearch: string;
  selectedMediaType: string | null;
  selectedTag: string | null;
  selectedCountry: string | null;
  selectedCity: string | null;
  dateRange: string;
}

/** true solo cuando no hay texto ni ningún filtro activo. */
export function isExploreZeroQueryState(input: ExploreQueryStateInput): boolean {
  return (
    input.debouncedSearch.trim().length === 0 &&
    input.selectedMediaType === null &&
    input.selectedTag === null &&
    input.selectedCountry === null &&
    input.selectedCity === null &&
    input.dateRange === "all"
  );
}
