import React from "react";
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator } from "react-native";
import { colors, relayTierLabels, RelayTier } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { RelayState, RelayOverrides } from "../mock/mockMeterData";

const TIERS: RelayTier[] = ["r1", "r2", "r3", "r4"];
const isWeb = Platform.OS === "web";

const TIER_META: Record<
  RelayTier,
  { devices: string; threshold: string; accent: string; tint: string; alwaysOn?: boolean }
> = {
  r1: {
    devices: "Lighting, phone charging",
    threshold: "Always on",
    accent: colors.terracotta[700],
    tint: colors.terracotta[100],
    alwaysOn: true,
  },
  r2: { devices: "Fans, some lights", threshold: "Sheds at 95% used", accent: colors.terracotta[500], tint: colors.neutral[100] },
  r3: { devices: "TV, sockets", threshold: "Sheds at 85% used", accent: colors.indigo[500], tint: colors.neutral[100] },
  r4: { devices: "Water heater, AC", threshold: "Sheds at 70% used", accent: colors.neutral[500], tint: colors.neutral[100] },
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
  /** "guide" (default): the descriptive left-accent-bar card list, showing
   * what's on each tier and when it sheds -- for Budget's load-priority
   * explainer. "compact": a plain label + ON/OFF pill grid -- for
   * Dashboard's live relay status, where the "why" is already covered
   * elsewhere on screen. */
  variant?: "guide" | "compact";
};

function nextOverrideValue(tier: RelayTier, current: boolean | undefined, displayedOn: boolean): boolean | null {
  // From auto, one tap should do the thing that looks obvious on screen --
  // flip whatever's currently displayed -- rather than always forcing ON
  // first regardless of state. Forcing ON when the load is already on (its
  // auto value) produced no visible change, so turning something off that
  // was already on used to take two taps instead of one.
  if (current === undefined) {
    // r1 (critical) can never be forced off -- the firmware's
    // applyOverrides() unconditionally ignores an off override for this
    // tier. Offering "off" here anyway used to write it to Firebase and
    // show a "FORCED OFF" badge the relay itself would never actually
    // honor. Only offer "force on" (useful when budget exhaustion has shed
    // it), never "force off".
    if (tier === "r1") return displayedOn ? null : true;
    return !displayedOn;
  }
  return null; // already forced (either direction) -> back to auto
}

export function RelayIndicator({ relays, overrides, onToggle, disabledTier, variant = "guide" }: Props) {
  const interactive = !!onToggle;

  if (variant === "compact") {
    return (
      <View style={styles.compactGrid}>
        {TIERS.map((tier) => {
          const override = overrides?.[tier];
          const isManual = override !== undefined;
          const on = isManual ? override : relays[tier];
          const busy = disabledTier === tier;
          // Nothing a tap could usefully do: r1 is on (its only allowed
          // override direction) and not currently manual.
          const locked = tier === "r1" && !isManual && on;

          const pill = (
            <View style={styles.compactCard}>
              <View style={styles.compactLabelRow}>
                <Text style={[typography.caption, styles.compactLabel]}>
                  {relayTierLabels[tier]} ({tier.toUpperCase()})
                </Text>
                <Text style={[typography.dataXs, styles.compactModeTag, isManual && styles.compactModeTagManual]}>
                  {isManual ? "MANUAL" : "AUTO"}
                </Text>
              </View>
              <View
                style={[
                  styles.compactPill,
                  busy ? styles.compactPillBusy : on ? styles.compactPillOn : styles.compactPillOff,
                ]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.indigo[500]} />
                ) : (
                  <>
                    <View style={[styles.compactDot, { backgroundColor: on ? colors.terracotta[500] : colors.neutral[500] }]} />
                    <Text style={[typography.dataXs, on ? styles.compactPillTextOn : styles.compactPillTextOff]}>
                      {on ? "ON" : "OFF"}
                    </Text>
                  </>
                )}
              </View>
            </View>
          );

          if (!interactive || locked) return <View key={tier} style={styles.compactItem}>{pill}</View>;

          return (
            <Pressable
              key={tier}
              onPress={() => onToggle(tier, nextOverrideValue(tier, override, on))}
              disabled={busy}
              style={({ pressed }) => [styles.compactItem, pressed && styles.pressed]}
            >
              {pill}
            </Pressable>
          );
        })}
      </View>
    );
  }

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
          const locked = tier === "r1" && !isManual && on;
          const meta = TIER_META[tier];

          const card = (
            <View style={[styles.card, isWeb && styles.cardWeb, { backgroundColor: meta.tint }]}>
              <View style={[styles.accentBar, { backgroundColor: meta.accent }]} />
              <View style={styles.cardBody}>
                <Text style={[typography.bodyStrong, styles.cardLabel, { color: meta.accent }]}>
                  {tier.toUpperCase()} {relayTierLabels[tier]}
                </Text>
                <Text style={[typography.caption, styles.cardDevices]}>{meta.devices}</Text>
              </View>
              <View style={styles.cardRight}>
                {busy ? (
                  <View style={styles.busyRow}>
                    <ActivityIndicator size="small" color={meta.accent} />
                    <Text style={[typography.dataXs, styles.busyText]}>Updating…</Text>
                  </View>
                ) : isManual ? (
                  <View style={styles.manualBadge}>
                    <Text style={styles.manualBadgeText}>{on ? "FORCED ON" : "FORCED OFF"}</Text>
                  </View>
                ) : (
                  <Text
                    style={[
                      typography.dataXs,
                      styles.cardThreshold,
                      meta.alwaysOn ? { color: meta.accent, fontWeight: "700" } : styles.cardThresholdDefault,
                    ]}
                  >
                    {meta.threshold}
                  </Text>
                )}
              </View>
            </View>
          );

          if (!interactive || locked) {
            return <View key={tier}>{card}</View>;
          }

          return (
            <Pressable
              key={tier}
              onPress={() => onToggle(tier, nextOverrideValue(tier, override, on))}
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
    borderRadius: radius.md,
    overflow: "hidden",
    paddingVertical: spacing.md,
    paddingRight: spacing.md,
  },
  cardWeb: { flexBasis: 260, flexGrow: 1, minWidth: 240 },
  accentBar: { width: 4, borderRadius: 2, alignSelf: "stretch", marginRight: spacing.md },
  cardBody: { flex: 1, gap: 2 },
  cardLabel: {},
  cardDevices: { color: colors.textSecondary },
  cardRight: { alignItems: "flex-end", justifyContent: "center", minWidth: 84, maxWidth: 100 },
  cardThreshold: { fontSize: 12, textAlign: "right" },
  cardThresholdDefault: { color: colors.textPrimary },
  manualBadge: {
    backgroundColor: colors.terracotta[500],
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  manualBadgeText: { color: colors.neutral.white, fontSize: 9, fontWeight: "700" },
  busyRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  busyText: { color: colors.textSecondary },
  hint: { color: colors.textSecondary, opacity: 0.85, marginTop: spacing.sm },

  // ── Compact (Dashboard "Relay Status") ──
  compactGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  compactItem: { flexBasis: "47%", flexGrow: 1, minWidth: 140 },
  compactCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  compactLabelRow: { gap: 2, flexShrink: 1 },
  compactLabel: { color: colors.textPrimary },
  compactModeTag: { color: colors.textSecondary, letterSpacing: 0.5, opacity: 0.75 },
  compactModeTagManual: { color: colors.terracotta[500], opacity: 1, fontWeight: "700" },
  compactPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    minWidth: 52,
    justifyContent: "center",
  },
  compactPillOn: { backgroundColor: colors.terracotta[100] },
  compactPillOff: { backgroundColor: colors.neutral[100] },
  compactPillBusy: { backgroundColor: colors.indigo[100] },
  compactDot: { width: 6, height: 6, borderRadius: 3 },
  compactPillTextOn: { color: colors.terracotta[700] },
  compactPillTextOff: { color: colors.textSecondary },
});
