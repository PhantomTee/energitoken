import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, relayTierLabels, RelayTier } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { RelayState, RelayOverrides } from "../mock/mockMeterData";

const TIERS: RelayTier[] = ["r1", "r2", "r3", "r4"];

type Props = {
  relays: RelayState;
  /** Present + non-empty enables manual control; omit for a read-only strip. */
  overrides?: RelayOverrides;
  /** Called with the next value to write when a tier is tapped: true (force
   * on), false (force off), or null (clear back to auto). Cycles Auto → ON →
   * OFF → Auto. Omit to render a non-interactive strip (e.g. read-only views). */
  onToggle?: (tier: RelayTier, next: boolean | null) => void;
  disabledTier?: RelayTier | null;
};

function nextOverrideValue(current: boolean | undefined): boolean | null {
  if (current === undefined) return true; // auto -> force ON
  if (current === true) return false; // force ON -> force OFF
  return null; // force OFF -> auto
}

export function RelayIndicator({ relays, overrides, onToggle, disabledTier }: Props) {
  const interactive = !!onToggle;

  return (
    <View style={styles.list}>
      {TIERS.map((tier) => {
        const override = overrides?.[tier];
        const isManual = override !== undefined;
        // Manual override wins visually over the live relay state, since it
        // represents user intent even before firmware has caught up to it.
        const on = isManual ? override : relays[tier];
        const busy = disabledTier === tier;

        const row = (
          <View style={styles.row}>
            <Text style={[typography.label, styles.tierLabel]}>{relayTierLabels[tier]}</Text>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  {
                    width: on ? "100%" : "18%",
                    backgroundColor: on ? colors.success : colors.neutral[700],
                  },
                ]}
              />
            </View>
            <View style={styles.statusGroup}>
              {isManual && (
                <View style={styles.manualBadge}>
                  <Text style={styles.manualBadgeText}>MANUAL</Text>
                </View>
              )}
              <Text style={[typography.dataXs, styles.status, { color: on ? colors.success : colors.textSecondary }]}>
                {busy ? "…" : on ? "ON" : "SHED"}
              </Text>
            </View>
          </View>
        );

        if (!interactive) {
          return <View key={tier}>{row}</View>;
        }

        return (
          <Pressable
            key={tier}
            onPress={() => onToggle(tier, nextOverrideValue(override))}
            disabled={busy}
            style={({ pressed }) => [styles.pressableRow, pressed && styles.pressed]}
          >
            {row}
          </Pressable>
        );
      })}
      {interactive && (
        <Text style={[typography.caption, styles.hint]}>
          Tap a load to force it on or off. Tap again to clear the override and return to automatic budget control.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center" },
  pressableRow: { borderRadius: radius.md },
  pressed: { opacity: 0.6 },
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
  statusGroup: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minWidth: 88, justifyContent: "flex-end" },
  status: { width: 40, textAlign: "right" },
  manualBadge: {
    backgroundColor: colors.terracotta[500],
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  manualBadgeText: { color: colors.neutral.white, fontSize: 9, fontWeight: "700" },
  hint: { color: colors.textSecondary, opacity: 0.75, marginTop: spacing.xs },
});
