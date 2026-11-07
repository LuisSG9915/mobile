import type { ReactNode } from "react";
import { Pressable, Text } from "react-native";

export function DockButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      accessibilityLabel={label}
      accessibilityRole="button"
      className={`items-center justify-center w-11 h-11 ${disabled ? "opacity-50" : ""}`}
    >
      {icon}
      <Text className="text-[9px] text-white/80 mt-0.5">{label}</Text>
    </Pressable>
  );
}
