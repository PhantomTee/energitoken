import React, { useState } from "react";
import { View, Text, StyleSheet, LayoutChangeEvent } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { whToUnits } from "../services/units";

/**
 * Daily consumption against the daily allowance.
 *
 * Same data the Budget screen has always plotted, but drawn as a real chart
 * rather than a row of flex-height <View>s. The old version had three
 * specific problems this fixes:
 *
 *  - No y scale at all. Every bar was sized as a percentage of the allowance
 *    and then clamped to 100%, so a day at 3x the budget looked identical to
 *    a day exactly at it -- the overshoot, the single most useful thing on
 *    the chart, was the one thing it could not show. Here the y axis is
 *    scaled to whichever is larger, the worst day or the allowance, so an
 *    overshoot is visible as an overshoot.
 *  - No allowance reference. "Over allowance" was encoded only as a bar
 *    colour change, which tells you a threshold was crossed but not by how
 *    much. There's now an actual dashed line at the allowance to read against.
 *  - No axis labels, so no way to know what any height meant in units.
 *
 * Bars draw whether or not a budget is set. The card used to render nothing
 * but a line of explanatory text without one, on the reasoning that there was
 * no reference to compare against -- but a household's own consumption is
 * worth seeing on its own terms, and hiding it meant an unbudgeted meter
 * showed a blank card even while measuring perfectly well. The ALLOWANCE is
 * what needs a budget, so that is what is now conditional: the dashed line
 * and the over/under colouring appear once one is set, and the bars are drawn
 * in a single neutral colour until then.
 */

const CHART_HEIGHT = 190;
const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 28;
const BAR_GAP_RATIO = 0.3;

/** Above this many bars the date labels collide, so only every Nth is drawn
 * (always including the last, which is today and the one people look for). */
const MAX_LABELS = 8;

export function DailyUsageChart({
  days,
  budgetUnitsPerDay,
}: {
  days: { key: string; label: string; wh: number }[];
  budgetUnitsPerDay: number | null;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const hasBudget = budgetUnitsPerDay !== null && budgetUnitsPerDay > 0;
  const dayUnits = days.map((d) => whToUnits(d.wh));
  const worstDay = dayUnits.length > 0 ? Math.max(...dayUnits) : 0;
  const anyUsage = worstDay > 0;

  // Headroom above the taller of (worst day, allowance) so the peak bar and
  // the allowance line both sit inside the frame rather than on its edge.
  const yMax = Math.max(worstDay, hasBudget ? budgetUnitsPerDay! : 0) * 1.15 || 1;

  const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const yFor = (units: number) => PAD_TOP + (1 - units / yMax) * plotH;

  const slot = days.length > 0 ? plotW / days.length : 0;
  const barW = slot * (1 - BAR_GAP_RATIO);
  const labelEvery = Math.max(1, Math.ceil(days.length / MAX_LABELS));

  const gridUnits = [0, 0.5, 1].map((f) => yMax * f);

  const totalUnits = dayUnits.reduce((sum, u) => sum + u, 0);
  const overDays = hasBudget ? dayUnits.filter((u) => u > budgetUnitsPerDay!).length : 0;

  return (
    <View style={styles.card} onLayout={onLayout}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[typography.h2, styles.title]}>Daily use vs allowance</Text>
          <Text style={[typography.caption, styles.subtitle]}>
            {anyUsage
              ? `${totalUnits.toLocaleString(undefined, { maximumFractionDigits: 2 })} units over ${days.length} days` +
                (hasBudget ? ` · ${overDays} day${overDays === 1 ? "" : "s"} over allowance` : "")
              : `Last ${days.length} days`}
          </Text>
        </View>
        {hasBudget && (
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: colors.indigo[500] }]} />
              <Text style={[typography.caption, styles.legendText]}>Within</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: colors.terracotta[500] }]} />
              <Text style={[typography.caption, styles.legendText]}>Over</Text>
            </View>
          </View>
        )}
      </View>

      {!anyUsage ? (
        <Text style={[typography.caption, styles.empty]}>
          No consumption measured in this period yet. Bars appear as the meter records usage.
        </Text>
      ) : (
        width > 0 && (
          <Svg width={width} height={CHART_HEIGHT}>
            {/* Gridlines and their labels are two separate passes rather than
                one pass emitting a Fragment per row: react-native-svg renders
                its children by mapping element types onto native views, and a
                Fragment in that tree is not a shape it can map. */}
            {gridUnits.map((units, i) => (
              <Line
                key={`g${i}`}
                x1={PAD_LEFT}
                y1={yFor(units)}
                x2={PAD_LEFT + plotW}
                y2={yFor(units)}
                stroke={colors.border}
                strokeWidth={1}
              />
            ))}
            {gridUnits.map((units, i) => (
              <SvgText
                key={`gl${i}`}
                x={PAD_LEFT - 6}
                y={yFor(units) + 4}
                fill={colors.textSecondary}
                fontSize={10}
                textAnchor="end"
              >
                {units >= 10 ? Math.round(units).toString() : units.toFixed(1)}
              </SvgText>
            ))}

            {days.map((day, i) => {
              const units = dayUnits[i];
              const over = hasBudget && units > budgetUnitsPerDay!;
              const x = PAD_LEFT + i * slot + (slot - barW) / 2;
              // A day with real-but-tiny usage still gets a visible sliver --
              // otherwise "used a little" and "used nothing" look the same.
              const top = units > 0 ? Math.min(yFor(units), yFor(0) - 2) : yFor(0);
              return (
                <Rect
                  key={day.key}
                  x={x}
                  y={top}
                  width={Math.max(1, barW)}
                  height={Math.max(0, yFor(0) - top)}
                  rx={2}
                  fill={over ? colors.terracotta[500] : colors.indigo[500]}
                />
              );
            })}

            {/* The allowance itself -- drawn after the bars so it stays
                readable where a bar crosses it. Absent entirely without a
                budget, since there is then nothing to reference against. */}
            {hasBudget && <Line
              x1={PAD_LEFT}
              y1={yFor(budgetUnitsPerDay!)}
              x2={PAD_LEFT + plotW}
              y2={yFor(budgetUnitsPerDay!)}
              stroke={colors.neutral[700]}
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />}
            {hasBudget && (
              <SvgText
                x={PAD_LEFT + plotW}
                y={yFor(budgetUnitsPerDay!) - 5}
                fill={colors.neutral[700]}
                fontSize={10}
                textAnchor="end"
              >
                allowance
              </SvgText>
            )}

            {days.map((day, i) =>
              i % labelEvery === 0 || i === days.length - 1 ? (
                <SvgText
                  key={`l${day.key}`}
                  x={PAD_LEFT + i * slot + slot / 2}
                  y={CHART_HEIGHT - PAD_BOTTOM + 15}
                  fill={colors.textSecondary}
                  fontSize={10}
                  textAnchor="middle"
                >
                  {i === days.length - 1 ? "Today" : day.label}
                </SvgText>
              ) : null
            )}
          </Svg>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  headerText: { flex: 1, gap: 2 },
  title: { color: colors.textPrimary },
  subtitle: { color: colors.textSecondary },
  legend: { gap: spacing.xs },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  legendSwatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { color: colors.textSecondary },
  empty: { color: colors.textSecondary },
});
