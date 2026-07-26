import React, { useEffect, useRef } from "react";
import { Animated, Text, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";

type Props = {
  message: string | null;
  onHide: () => void;
  durationMs?: number;
};

/** A brief top-of-screen banner, used for events the user should notice
 * immediately even if they're not looking at the exact card that changed
 * (e.g. a relay tier being shed). Auto-dismisses. */
export function Toast({ message, onHide, durationMs = 4000 }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return;
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(onHide);
    }, durationMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!message) return null;

  return (
    <Animated.View style={[styles.toast, { opacity }]} pointerEvents="none">
      <Text style={[typography.caption, styles.text]}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    top: 8,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.terracotta[500],
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    zIndex: 20,
  },
  text: { color: colors.neutral.white, textAlign: "center" },
});
