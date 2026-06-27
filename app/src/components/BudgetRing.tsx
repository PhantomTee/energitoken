import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colors } from "../theme/colors";
import { typography, spacing } from "../theme/typography";

/**
 * Budget-used ring. Color shifts from indigo (plenty left) to terracotta
 * (running low) so the household gets a glanceable read without needing
 * to parse the number. Type scales with `size` instead of using a fixed
 * typography style, so the percentage never overruns the ring at small
 * sizes (e.g. the 96px inset used in the dashboard hero card) — and the
 * "budget used" caption only shows when there's room for it.
 */
export function BudgetRing({ percentUsed, size = 160 }: { percentUsed: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, percentUsed));
  const strokeWidth = size * 0.09;
  const radiusPx = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radiusPx;
  const dashOffset = circumference * (1 - clamped / 100);
  const ringColor = clamped >= 80 ? colors.terracotta[400] : colors.indigo[400];
  const showCaption = size >= 120;
  const percentFontSize = Math.max(14, Math.round(size * 0.24));

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radiusPx}
          stroke={colors.border}
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
      <View style={[styles.center, { width: radiusPx * 1.6 }]}>
        <Text
          style={[
            typography.data,
            { color: ringColor, fontSize: percentFontSize, lineHeight: percentFontSize * 1.05 },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {Math.round(clamped)}%
        </Text>
        {showCaption && <Text style={[typography.label, styles.caption]}>budget used</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", justifyContent: "center" },
  center: { position: "absolute", alignItems: "center" },
  caption: { color: colors.textSecondary, marginTop: spacing.xs, fontSize: 10 },
});
