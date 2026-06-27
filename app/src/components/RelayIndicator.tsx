import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, relayTierLabels, RelayTier } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { RelayState } from "../mock/mockMeterData";

const TIERS: RelayTier[] = ["r1", "r2", "r3", "r4"];

export function RelayIndicator({ relays }: { relays: RelayState }) {
  return (
    <View style={styles.list}>
      {TIERS.map((tier) => {
        const on = relays[tier];
        return (
          <View key={tier} style={styles.row}>
            <Text style={[typography.label, styles.tierLabel]}>{relayTierLabels[tier]}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: on ? "100%" : "18%", backgroundColor: on ? colors.success : colors.neutral[700] }]} />
            </View>
            <Text style={[typography.dataXs, styles.status, { color: on ? colors.success : colors.textSecondary }]}>
              {on ? "ON" : "SHED"}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center" },
  tierLabel: { color: colors.textPrimary, width: 84 },
  track: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    overflow: "hidden",
    marginHorizontal: spacing.md,
  },
  fill: { height: "100%", borderRadius: radius.pill },
  status: { width: 40, textAlign: "right" },
});
