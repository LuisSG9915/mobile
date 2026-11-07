import { Image } from "expo-image";
import { useCallback, useEffect, useState } from "react";
import { useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { computeSwipeDismissFrame, shouldTriggerSwipeDismiss } from "../lib/viewer-physics";

const SWIPE_DOWN_THRESHOLD = 110;

export function ZoomableImage({
  uri,
  previewUri,
  originalUri,
  thumbhash,
  active,
  onDismiss,
  onDoubleTap,
  onSingleTap,
  onZoomChange,
  onDeepZoom,
  backdropOpacity,
}: {
  uri: string;
  previewUri?: string | null;
  originalUri?: string | null;
  thumbhash: string;
  active: boolean;
  onDismiss?: () => void;
  onDoubleTap?: () => void;
  onSingleTap?: () => void;
  onZoomChange?: (zoomed: boolean) => void;
  onDeepZoom?: () => void;
  backdropOpacity?: SharedValue<number>;
}) {
  const { height } = useWindowDimensions();
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const dragScale = useSharedValue(1);
  const borderRadius = useSharedValue(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const zoomState = useSharedValue(0);
  const [isZoomed, setIsZoomed] = useState(false);
  const [deepZoom, setDeepZoom] = useState(false);

  const handleDeepZoom = useCallback(() => {
    setDeepZoom(true);
    onDeepZoom?.();
  }, [onDeepZoom]);

  const notifyZoom = useCallback(
    (zoomed: boolean) => {
      setIsZoomed(zoomed);
      onZoomChange?.(zoomed);
    },
    [onZoomChange],
  );

  const syncZoom = (zoomed: boolean, deep: boolean) => {
    "worklet";
    if (!active) return;
    const next = zoomed ? 1 : 0;
    if (zoomState.value !== next) {
      zoomState.value = next;
      runOnJS(notifyZoom)(zoomed);
    }
    if (deep) {
      runOnJS(handleDeepZoom)();
    }
  };

  useEffect(() => {
    if (active) return;
    const wasZoomed = zoomState.value !== 0;
    scale.value = 1;
    saved.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
    dragScale.value = 1;
    borderRadius.value = 0;
    zoomState.value = 0;
    setDeepZoom(false);
    if (backdropOpacity) backdropOpacity.value = 1;
    if (wasZoomed) notifyZoom(false);
  }, [
    active,
    scale,
    saved,
    dragScale,
    borderRadius,
    tx,
    ty,
    savedTx,
    savedTy,
    zoomState,
    backdropOpacity,
    notifyZoom,
  ]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(5, saved.value * e.scale));
      dragScale.value = 1;
      borderRadius.value = 0;
      if (backdropOpacity) backdropOpacity.value = 1;
      syncZoom(scale.value > 1.01, scale.value > 1.5);
    })
    .onEnd(() => {
      saved.value = scale.value;
      if (scale.value <= 1) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
        syncZoom(false, false);
      }
    });

  const panBase = isZoomed
    ? Gesture.Pan()
    : Gesture.Pan().activeOffsetY([-14, 14]).failOffsetX([-14, 14]);
  const pan = panBase
    .minPointers(1)
    .onUpdate((e) => {
      if (saved.value > 1) {
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
        if (backdropOpacity) backdropOpacity.value = 1;
        return;
      }

      const vertical = Math.abs(e.translationY) > Math.abs(e.translationX) * 0.7;
      if (e.translationY > 8 && (vertical || ty.value > 0)) {
        const frame = computeSwipeDismissFrame(e.translationX, e.translationY, height);
        tx.value = frame.tx;
        ty.value = frame.ty;
        dragScale.value = frame.scale;
        borderRadius.value = frame.borderRadius;
        if (backdropOpacity) backdropOpacity.value = frame.backdropOpacity;
      } else if (e.translationY <= 0) {
        const frame = computeSwipeDismissFrame(e.translationX, e.translationY, height);
        tx.value = frame.tx;
        ty.value = frame.ty;
        dragScale.value = 1;
        borderRadius.value = 0;
        if (backdropOpacity) backdropOpacity.value = 1;
      } else {
        tx.value = 0;
        ty.value = 0;
        dragScale.value = 1;
        borderRadius.value = 0;
        if (backdropOpacity) backdropOpacity.value = 1;
      }
    })
    .onEnd((e) => {
      if (saved.value > 1) {
        savedTx.value = tx.value;
        savedTy.value = ty.value;
        return;
      }
      if (
        onDismiss &&
        shouldTriggerSwipeDismiss(e.translationY, e.velocityY, SWIPE_DOWN_THRESHOLD)
      ) {
        runOnJS(onDismiss)();
        return;
      }
      tx.value = withSpring(0);
      ty.value = withSpring(0);
      dragScale.value = withSpring(1);
      borderRadius.value = withTiming(0, { duration: 150 });
      if (backdropOpacity) backdropOpacity.value = withTiming(1, { duration: 150 });
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (onDoubleTap) {
        runOnJS(onDoubleTap)();
      }
      const next = saved.value > 1 ? 1 : 2.5;
      saved.value = next;
      scale.value = withTiming(next);
      dragScale.value = 1;
      borderRadius.value = 0;
      if (backdropOpacity) backdropOpacity.value = 1;
      syncZoom(next > 1, next > 1.5);
      if (next === 1) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      if (onSingleTap) runOnJS(onSingleTap)();
    });
  const taps = Gesture.Exclusive(doubleTap, singleTap);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value * dragScale.value },
    ],
    borderRadius: borderRadius.value,
    overflow: "hidden",
  }));

  const activeImageUri = (deepZoom && originalUri) || uri || previewUri || originalUri;

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, taps)}>
      <Animated.View style={[{ flex: 1 }, style]}>
        <Image
          source={activeImageUri ? { uri: activeImageUri } : undefined}
          placeholder={{ thumbhash }}
          contentFit="contain"
          style={{ flex: 1 }}
          transition={150}
        />
      </Animated.View>
    </GestureDetector>
  );
}
