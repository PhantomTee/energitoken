import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors } from "../theme/colors";
import { typography, spacing } from "../theme/typography";

/**
 * Budget-used ring. Color shifts from indigo (plenty left) to terracotta
 * (running low) so the household gets a glanceable read without needing
 * to parse the number.
 */
export function BudgetRing({ percentUsed, size = 160 }: { percentUsed: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, percentUsed));
  const strokeWidth = size * 0.09;
  const radiusPx = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radiusPx;
  const dashOffset = circumference * (1 - clamped / 100);
  const ringColor = clamped >= 80 ? colors.terracotta[500] : colors.indigo[500];

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radiusPx}
          stroke={colors.neutral[100]}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radiusPx}
          stroke={ringColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.center}>
        <Text style={[typography.display, { color: ringColor }]}>{Math.round(clamped)}%</Text>
        <Text style={[typography.caption, styles.caption]}>budget used</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", justifyContent: "center" },
  center: { position: "absolute", alignItems: "center" },
  caption: { color: colors.textSecondary, marginTop: spacing.xs },
});
