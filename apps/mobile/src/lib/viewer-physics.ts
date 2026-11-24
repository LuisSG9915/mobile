export interface SwipeDismissFrame {
  tx: number;
  ty: number;
  scale: number;
  borderRadius: number;
  backdropOpacity: number;
}

/**
 * Física pura del swipe-to-close del visor. Se ejecuta en worklets de
 * Reanimated y también se testea con Vitest (sin React Native).
 */
export function computeSwipeDismissFrame(
  translationX: number,
  translationY: number,
  screenHeight: number,
): SwipeDismissFrame {
  "worklet";
  if (translationY <= 0) {
    return {
      tx: translationX * 0.25,
      ty: translationY * 0.25,
      scale: 1,
      borderRadius: 0,
      backdropOpacity: 1,
    };
  }

  const safeHeight = Math.max(1, screenHeight * 0.45);
  const progress = Math.min(1, translationY / safeHeight);

  return {
    tx: translationX * 0.65,
    ty: translationY,
    scale: Math.max(0.72, 1 - progress * 0.25),
    borderRadius: Math.min(24, progress * 24),
    backdropOpacity: Math.max(0, 1 - progress * 0.85),
  };
}

/** Cierra por distancia recorrida o por un flick rápido del pulgar. */
export function shouldTriggerSwipeDismiss(
  translationY: number,
  velocityY: number,
  threshold = 110,
): boolean {
  "worklet";
  return translationY > threshold || (translationY > 45 && velocityY > 650);
}

// ---------- Bloque 3: motor de física del visor ----------

export interface ViewerDimensions {
  viewportWidth: number;
  viewportHeight: number;
  imageWidth: number;
  imageHeight: number;
}

export interface PanOffset {
  x: number;
  y: number;
}

export const MIN_ZOOM_SCALE = 1;
export const MAX_ZOOM_SCALE = 5;
export const DOUBLE_TAP_ZOOM_SCALE = 2.5;
export const HIGH_RES_ZOOM_THRESHOLD = 1.5;
export const DISMISS_DRAG_DISTANCE_PX = 110;
export const DISMISS_DRAG_VELOCITY_PX = 850;

export function computeFittedSize(dims: ViewerDimensions): { width: number; height: number } {
  const vw = Math.max(1, dims.viewportWidth);
  const vh = Math.max(1, dims.viewportHeight);
  const iw = Math.max(1, dims.imageWidth);
  const ih = Math.max(1, dims.imageHeight);
  const scale = Math.min(vw / iw, vh / ih);
  return { width: iw * scale, height: ih * scale };
}

export function clampPanTranslation(
  translateX: number,
  translateY: number,
  scale: number,
  dims: ViewerDimensions,
): PanOffset {
  "worklet";
  if (scale <= 1.01) return { x: 0, y: 0 };
  const vw = Math.max(1, dims.viewportWidth);
  const vh = Math.max(1, dims.viewportHeight);
  const iw = Math.max(1, dims.imageWidth);
  const ih = Math.max(1, dims.imageHeight);
  const fitScale = Math.min(vw / iw, vh / ih);
  const scaledWidth = iw * fitScale * scale;
  const scaledHeight = ih * fitScale * scale;
  const maxOffsetX = Math.max(0, (scaledWidth - vw) / 2);
  const maxOffsetY = Math.max(0, (scaledHeight - vh) / 2);
  return {
    x: Math.max(-maxOffsetX, Math.min(maxOffsetX, translateX)),
    y: Math.max(-maxOffsetY, Math.min(maxOffsetY, translateY)),
  };
}

export function computeDoubleTapZoomTarget(
  tapX: number,
  tapY: number,
  currentScale: number,
  dims: ViewerDimensions,
  targetScale = DOUBLE_TAP_ZOOM_SCALE,
): { scale: number; x: number; y: number } {
  "worklet";
  if (currentScale > 1.05) return { scale: 1, x: 0, y: 0 };
  const centerX = dims.viewportWidth / 2;
  const centerY = dims.viewportHeight / 2;
  const rawX = (centerX - tapX) * (targetScale - 1);
  const rawY = (centerY - tapY) * (targetScale - 1);
  const clamped = clampPanTranslation(rawX, rawY, targetScale, dims);
  return { scale: targetScale, x: clamped.x, y: clamped.y };
}

export function shouldDismissOnVerticalSwipe(
  translateY: number,
  velocityY: number,
  currentScale: number,
): boolean {
  "worklet";
  if (currentScale > 1.05) return false;
  const absY = Math.abs(translateY);
  return (
    absY >= DISMISS_DRAG_DISTANCE_PX ||
    (absY >= 36 && Math.abs(velocityY) >= DISMISS_DRAG_VELOCITY_PX)
  );
}

export function computeBackdropOpacity(translateY: number, viewportHeight: number): number {
  "worklet";
  const safeHeight = Math.max(1, viewportHeight);
  const progress = Math.min(1, Math.abs(translateY) / (safeHeight * 0.45));
  return Math.max(0.15, 1 - progress * 0.85);
}

export function shouldLoadFullResolution(
  scale: number,
  threshold = HIGH_RES_ZOOM_THRESHOLD,
): boolean {
  "worklet";
  return scale >= threshold;
}
