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
