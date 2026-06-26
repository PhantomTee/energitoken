import React from "react";
import { View, Text, StyleSheet, Switch, Platform } from "react-native";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";

export function LiveMockBanner({
  mode,
  onToggle,
}: {
  mode: "mock" | "live";
  onToggle: (next: "mock" | "live") => void;
}) {
  const isLive = mode === "live";
  return (
    <View style={styles.banner}>
      <View style={[styles.dot, { backgroundColor: isLive ? colors.success : colors.warning }]} />
      <Text style={[typography.bodyStrong, styles.text]}>{isLive ? "Live data" : "Mock data"}</Text>
      <View style={{ flex: 1 }} />
      <Switch
        value={isLive}
        onValueChange={(v) => onToggle(v ? "live" : "mock")}
        trackColor={{ false: colors.neutral[300], true: colors.indigo[300] }}
        thumbColor={Platform.OS === "android" ? colors.indigo[700] : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.sm },
  text: { color: colors.textPrimary },
});
