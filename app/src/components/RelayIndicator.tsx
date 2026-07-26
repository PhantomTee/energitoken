import React from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { colors, relayTierLabels, RelayTier } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { RelayState, RelayOverrides } from "../mock/mockMeterData";

const TIERS: RelayTier[] = ["r1", "r2", "r3", "r4"];
const isWeb = Platform.OS === "web";

const TIER_META: Record<RelayTier, { icon: string; detail: string }> = {
  r1: { icon: "💡", detail: "Lighting, phone charging — never shed" },
  r2: { icon: "🌀", detail: "Fans, some lights — sheds at 95%" },
  r3: { icon: "📺", detail: "TV, sockets — sheds at 85%" },
  r4: { icon: "🔥", detail: "Water heater, AC — sheds at 70%" },
};

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

/** On native this is a compact stacked list, one row per tier -- the right
 * shape for a narrow phone screen. On web it's a grid of cards so it reads
 * as a real desktop panel instead of the same thin list just stretched
 * across a wide viewport. */
export function RelayIndicator({ relays, overrides, onToggle, disabledTier }: Props) {
  const interactive = !!onToggle;

  if (isWeb) {
    return (
      <View>
        <View style={styles.grid}>
          {TIERS.map((tier) => {
            const override = overrides?.[tier];
            const isManual = override !== undefined;
            const on = isManual ? override : relays[tier];
            const busy = disabledTier === tier;
            const meta = TIER_META[tier];

            const card = (
              <View style={[styles.card, on ? styles.cardOn : styles.cardOff]}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardIcon}>{meta.icon}</Text>
                  {isManual && (
                    <View style={styles.manualBadge}>
                      <Text style={styles.manualBadgeText}>MANUAL</Text>
                    </View>
                  )}
                </View>
                <Text style={[typography.bodyStrong, styles.cardLabel]}>{relayTierLabels[tier]}</Text>
                <Text
                  style={[
                    typography.dataSm,
                    styles.cardStatus,
                    { color: on ? colors.success : colors.textSecondary },
                  ]}
                >
                  {busy ? "…" : on ? "ON" : "SHED"}
                </Text>
                <View style={styles.cardBar}>
                  <View
                    style={[
                      styles.cardBarFill,
                      { width: on ? "100%" : "12%", backgroundColor: on ? colors.success : colors.neutral[700] },
                    ]}
                  />
                </View>
                <Text style={[typography.caption, styles.cardDetail]}>{meta.detail}</Text>
              </View>
            );

            if (!interactive) {
              return <View key={tier}>{card}</View>;
            }

            return (
              <Pressable
                key={tier}
                onPress={() => onToggle(tier, nextOverrideValue(override))}
                disabled={busy}
                style={({ pressed, hovered }: any) => [pressed && styles.pressed, hovered && styles.hovered]}
              >
                {card}
              </Pressable>
            );
          })}
        </View>
        {interactive && (
          <Text style={[typography.caption, styles.hint]}>
            Click a load to force it on or off. Click again to clear the override and return to automatic budget
            control.
          </Text>
        )}
      </View>
    );
  }

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
  hovered: { opacity: 0.85 },
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
  hint: { color: colors.textSecondary, opacity: 0.75, marginTop: spacing.sm },

  // ── Web grid ──
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  card: {
    flexBasis: 200,
    flexGrow: 1,
    minWidth: 180,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  cardOn: { backgroundColor: colors.surface, borderColor: colors.border },
  cardOff: { backgroundColor: colors.surface, borderColor: colors.border, opacity: 0.85 },
  cardTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardIcon: { fontSize: 22 },
  cardLabel: { color: colors.textPrimary, marginTop: spacing.xs },
  cardStatus: { letterSpacing: 0.5 },
  cardBar: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    overflow: "hidden",
    marginTop: spacing.xs,
  },
  cardBarFill: { height: "100%", borderRadius: radius.pill },
  cardDetail: { color: colors.textSecondary, opacity: 0.75, marginTop: spacing.xs },
});
