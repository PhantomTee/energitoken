import React from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { colors, relayTierLabels, RelayTier } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { RelayState, RelayOverrides } from "../mock/mockMeterData";

const TIERS: RelayTier[] = ["r1", "r2", "r3", "r4"];
const isWeb = Platform.OS === "web";

const TIER_META: Record<RelayTier, { icon: string; devices: string; threshold: string }> = {
  r1: { icon: "💡", devices: "Lighting, phone charging", threshold: "Always on" },
  r2: { icon: "🌀", devices: "Fans, some lights", threshold: "Sheds at 95%" },
  r3: { icon: "📺", devices: "TV, sockets", threshold: "Sheds at 85%" },
  r4: { icon: "🔥", devices: "Water heater, AC", threshold: "Sheds at 70%" },
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

/** On native this is a stacked list of left-accent-bar cards -- tier,
 * devices, and shed threshold at a glance, same shape as a load-priority
 * guide. On web it's a grid of the same cards so it reads as a real
 * desktop panel instead of a thin list stretched across a wide viewport. */
export function RelayIndicator({ relays, overrides, onToggle, disabledTier }: Props) {
  const interactive = !!onToggle;

  return (
    <View>
      <View style={isWeb ? styles.grid : styles.list}>
        {TIERS.map((tier) => {
          const override = overrides?.[tier];
          const isManual = override !== undefined;
          // Manual override wins visually over the live relay state, since it
          // represents user intent even before firmware has caught up to it.
          const on = isManual ? override : relays[tier];
          const busy = disabledTier === tier;
          const meta = TIER_META[tier];
          const barColor = isManual ? colors.terracotta[500] : on ? colors.success : colors.neutral[500];

          const card = (
            <View style={[styles.card, isWeb && styles.cardWeb]}>
              <View style={[styles.accentBar, { backgroundColor: barColor }]} />
              <View style={styles.cardIconWrap}>
                <Text style={styles.cardIcon}>{meta.icon}</Text>
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardTopRow}>
                  <Text style={[typography.bodyStrong, styles.cardLabel]}>{relayTierLabels[tier]}</Text>
                  {isManual && (
                    <View style={styles.manualBadge}>
                      <Text style={styles.manualBadgeText}>MANUAL</Text>
                    </View>
                  )}
                </View>
                <Text style={[typography.caption, styles.cardDevices]}>{meta.devices}</Text>
              </View>
              <View style={styles.cardRight}>
                <Text
                  style={[typography.dataXs, styles.cardStatus, { color: on ? colors.success : colors.textSecondary }]}
                >
                  {busy ? "…" : on ? "ON" : "SHED"}
                </Text>
                <Text style={[typography.caption, styles.cardThreshold]}>{meta.threshold}</Text>
              </View>
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
          {isWeb ? "Click" : "Tap"} a load to force it on or off. {isWeb ? "Click" : "Tap"} again to clear the
          override and return to automatic budget control.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pressed: { opacity: 0.7 },
  hovered: { opacity: 0.9 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    paddingVertical: spacing.sm,
    paddingRight: spacing.md,
  },
  cardWeb: { flexBasis: 260, flexGrow: 1, minWidth: 240 },
  accentBar: { width: 4, alignSelf: "stretch", marginRight: spacing.md },
  cardIconWrap: { marginRight: spacing.sm },
  cardIcon: { fontSize: 20 },
  cardBody: { flex: 1, gap: 2 },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardLabel: { color: colors.textPrimary },
  cardDevices: { color: colors.textSecondary },
  cardRight: { alignItems: "flex-end", gap: 2, minWidth: 78 },
  cardStatus: { letterSpacing: 0.5 },
  cardThreshold: { color: colors.textSecondary, fontSize: 11 },
  manualBadge: {
    backgroundColor: colors.terracotta[500],
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  manualBadgeText: { color: colors.neutral.white, fontSize: 9, fontWeight: "700" },
  hint: { color: colors.textSecondary, opacity: 0.85, marginTop: spacing.sm },
});
