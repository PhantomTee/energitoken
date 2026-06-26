import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, relayTierLabels, RelayTier } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { RelayState } from "../mock/mockMeterData";

const TIERS: RelayTier[] = ["r1", "r2", "r3", "r4"];

export function RelayIndicator({ relays }: { relays: RelayState }) {
  return (
    <View style={styles.row}>
      {TIERS.map((tier) => {
        const on = relays[tier];
        return (
          <View key={tier} style={styles.segment}>
            <View style={[styles.dot, { backgroundColor: on ? colors.success : colors.neutral[300] }]} />
            <Text style={[typography.caption, styles.tierLabel]}>{relayTierLabels[tier]}</Text>
            <Text style={[typography.label, { color: on ? colors.success : colors.neutral[500] }]}>
              {on ? "ON" : "SHED"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between" },
  segment: {
    alignItems: "center",
    flex: 1,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    marginHorizontal: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: { width: 14, height: 14, borderRadius: 7, marginBottom: spacing.xs },
  tierLabel: { color: colors.textSecondary, marginBottom: 2 },
});
