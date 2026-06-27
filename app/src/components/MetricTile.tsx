import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";

export function MetricTile({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={styles.tile}>
      <Text style={[typography.label, styles.label]}>{label}</Text>
      <View style={styles.valueRow}>
        <Text style={[typography.dataMd, styles.value]}>{value}</Text>
        <Text style={[typography.dataXs, styles.unit]}>{unit}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { color: colors.textSecondary, marginBottom: spacing.xs },
  valueRow: { flexDirection: "row", alignItems: "baseline" },
  value: { color: colors.textPrimary },
  unit: { color: colors.textSecondary, marginLeft: spacing.xs },
});
