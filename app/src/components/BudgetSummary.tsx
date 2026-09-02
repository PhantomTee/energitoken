import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { BudgetRing } from "./BudgetRing";
import { unitsToWh } from "../services/units";

/**
 * The Budget screen's "where do I stand" block: budget-used ring, the three
 * figures behind it, and the cycle clock.
 *
 * Shared because it wasn't. Budget.tsx renders two entirely separate trees
 * for mobile and desktop, and this block only ever existed in the mobile one
 * -- so anybody using the web app saw a Budget page with no current budget,
 * no usage figure and no cycle clock on it at all, just the allocation form.
 * The two trees are the reason that gap went unnoticed for so long, and
 * duplicating this JSX into the desktop branch would have set up the same
 * drift again, so it lives here and both branches render it.
 *
 * `formatDuration` is exported alongside it because the cycle clock's wording
 * is part of this block's job, and having one definition here beats a second
 * copy in whichever screen needs to say the same thing.
 */

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function BudgetSummary({
  percentUsed,
  availableUnits,
  spendableWh,
  currentBudgetUnits,
  usedUnits,
  cycleClock,
  ringSize = 120,
}: {
  percentUsed: number;
  availableUnits: number | null;
  spendableWh: number | null;
  currentBudgetUnits: number | null;
  usedUnits: number | null;
  cycleClock: { elapsed: number; remaining: number } | null;
  ringSize?: number;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <BudgetRing percentUsed={percentUsed} size={ringSize} />
        <View style={styles.stats}>
          <View style={styles.statBlock}>
            <Text style={[typography.label, styles.label]}>Available</Text>
            <Text style={[typography.dataMd, styles.value]}>
              {availableUnits === null ? "···" : availableUnits.toLocaleString()}
              <Text style={[typography.dataXs, styles.unit]}> units</Text>
            </Text>
            <Text style={[typography.dataXs, styles.wh]}>
              ≈ {spendableWh === null ? "···" : spendableWh.toLocaleString()} Wh
            </Text>
          </View>
          <View style={styles.statBlock}>
            <Text style={[typography.label, styles.label]}>Budget</Text>
            <Text style={[typography.dataMd, styles.value]}>
              {currentBudgetUnits === null ? "--" : currentBudgetUnits.toLocaleString()}
              <Text style={[typography.dataXs, styles.unit]}> units/day</Text>
            </Text>
            {currentBudgetUnits === null ? (
              <Text style={[typography.dataXs, styles.wh]}>not set yet</Text>
            ) : (
              <Text style={[typography.dataXs, styles.wh]}>
                ≈ {unitsToWh(currentBudgetUnits).toLocaleString()} Wh/day
              </Text>
            )}
          </View>
          <View style={styles.statBlock}>
            <Text style={[typography.label, styles.label]}>Used today</Text>
            <Text style={[typography.dataMd, styles.value]}>
              {usedUnits === null ? "--" : usedUnits.toLocaleString()}
              <Text style={[typography.dataXs, styles.unit]}> units</Text>
            </Text>
            {usedUnits !== null && (
              <Text style={[typography.dataXs, styles.wh]}>
                ≈ {unitsToWh(usedUnits).toLocaleString()} Wh
              </Text>
            )}
          </View>
        </View>
      </View>

      <Text style={[typography.caption, styles.cycleNote]}>
        {cycleClock
          ? `Cycle started ${formatDuration(cycleClock.elapsed)} ago · resets in ~${formatDuration(
              cycleClock.remaining
            )}`
          : "A cycle is one budget day, as counted by your meter. Usage and shedding reset when the meter starts a new cycle."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    // Wraps rather than crushing the ring and three stat blocks onto one line
    // on a narrow phone.
    flexWrap: "wrap",
  },
  stats: { flex: 1, minWidth: 180, gap: spacing.md },
  statBlock: { gap: 2 },
  label: { color: colors.textSecondary },
  value: { color: colors.textPrimary },
  unit: { color: colors.textSecondary },
  wh: { color: colors.textSecondary },
  cycleNote: { color: colors.textSecondary, paddingHorizontal: spacing.xs },
});
