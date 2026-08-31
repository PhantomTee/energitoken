import React, { useState } from "react";
import { View, Text, StyleSheet, LayoutChangeEvent } from "react-native";
import Svg, { Line, Path, Circle, Text as SvgText } from "react-native-svg";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";

/**
 * Credit drawdown: how many days of electricity the household's remaining
 * balance actually buys, drawn as a line falling to zero.
 *
 * This replaces the old "Consumption Curve" on the Budget screen, which was
 * a row of flex-height <View>s with no axes, no scale labels and no y
 * reference of any kind -- it could show that one day's bar was taller than
 * another's and nothing else. The question a prepaid household actually has
 * is "when do my lights go off", and a bar chart of past days never answers
 * it. This does, on both axes at once: credit on y, calendar days on x, and
 * the x-intercept is the day the balance hits zero.
 *
 * Two lines, because there are two honest answers and they usually disagree:
 *
 *  - Budget rate (indigo): the plan. availableUnits / budgetUnitsPerDay --
 *    what the meter will *let* them use, since the firmware sheds loads once
 *    the daily allowance is spent. This is the promise the budget makes.
 *  - Actual rate (terracotta): the reality, from the trailing burn history.
 *    A household consistently under its allowance runs longer than the plan;
 *    one that keeps hitting the cap runs exactly to plan; one whose budget
 *    was set generously against a small balance runs out sooner than they
 *    think. Drawn dashed to read as a projection rather than a commitment.
 *
 * Deliberately projects forward only. Reconstructing a *past* balance curve
 * would need every top-up and peer transfer as well as the burn log, and
 * burnHistory alone holds only the burns -- a reconstruction from it would
 * silently draw a household that topped up mid-week as though it had been
 * bleeding credit the whole time. Rather than draw a confidently wrong
 * history, this shows only what can be derived honestly from the balance and
 * a rate.
 */

const CHART_HEIGHT = 200;
const PAD_LEFT = 44;
const PAD_RIGHT = 16;
const PAD_TOP = 12;
const PAD_BOTTOM = 30;

/** Caps the x axis so a household with a tiny budget against a large balance
 * (a runway of years) doesn't compress the interesting part of the chart into
 * the first two pixels. Past this, the axis stops and the line simply leaves
 * the right-hand edge still descending -- which reads correctly as "further
 * out than this chart bothers to show". */
const MAX_AXIS_DAYS = 60;
/** Floor, so a nearly-empty balance still gets a readable axis instead of a
 * single vertical drop at x=0. */
const MIN_AXIS_DAYS = 7;

function formatDayLabel(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Whole days, then hours below a day -- "runs out in 0 days" is useless to
 * somebody whose power is about to cut, and "in 18h" is actionable. */
function formatRunway(days: number): string {
  if (!Number.isFinite(days)) return "--";
  if (days >= 2) return `${Math.floor(days)} days`;
  const hours = Math.round(days * 24);
  if (hours >= 24) return "1 day";
  if (hours <= 0) return "now";
  return `${hours}h`;
}

export function BalanceRunwayChart({
  availableUnits,
  budgetUnitsPerDay,
  actualUnitsPerDay,
}: {
  availableUnits: number | null;
  budgetUnitsPerDay: number | null;
  actualUnitsPerDay: number | null;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const hasBalance = availableUnits !== null && availableUnits > 0;
  const budgetRate = budgetUnitsPerDay !== null && budgetUnitsPerDay > 0 ? budgetUnitsPerDay : null;
  const actualRate = actualUnitsPerDay !== null && actualUnitsPerDay > 0 ? actualUnitsPerDay : null;

  const budgetDays = hasBalance && budgetRate ? availableUnits! / budgetRate : null;
  const actualDays = hasBalance && actualRate ? availableUnits! / actualRate : null;

  // The axis has to cover whichever line runs longest, so neither is clipped
  // before its own zero crossing unless it exceeds MAX_AXIS_DAYS.
  const longest = Math.max(budgetDays ?? 0, actualDays ?? 0);
  const axisDays = Math.min(MAX_AXIS_DAYS, Math.max(MIN_AXIS_DAYS, Math.ceil(longest)));

  if (!hasBalance) {
    return (
      <View style={styles.card} onLayout={onLayout}>
        <Text style={[typography.h2, styles.title]}>Credit runway</Text>
        <Text style={[typography.caption, styles.empty]}>
          No spendable credit yet. Top up to see how long it lasts.
        </Text>
      </View>
    );
  }

  if (!budgetRate && !actualRate) {
    return (
      <View style={styles.card} onLayout={onLayout}>
        <Text style={[typography.h2, styles.title]}>Credit runway</Text>
        <Text style={[typography.caption, styles.empty]}>
          Set a budget below, or use some energy, and this will project when your{" "}
          {availableUnits!.toLocaleString()} units run out.
        </Text>
      </View>
    );
  }

  const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const xFor = (days: number) => PAD_LEFT + (Math.min(days, axisDays) / axisDays) * plotW;
  const yFor = (units: number) => PAD_TOP + (1 - units / availableUnits!) * plotH;

  // A line from full balance at today down to zero at its own runway -- or,
  // if that runway runs past the axis, down to whatever it still has left at
  // the right-hand edge, so the line exits the frame mid-descent rather than
  // being bent flat to hit zero inside it.
  const lineFor = (days: number, rate: number) => {
    if (days <= axisDays) return `M ${xFor(0)} ${yFor(availableUnits!)} L ${xFor(days)} ${yFor(0)}`;
    const remainingAtEdge = availableUnits! - rate * axisDays;
    return `M ${xFor(0)} ${yFor(availableUnits!)} L ${xFor(axisDays)} ${yFor(remainingAtEdge)}`;
  };

  const gridUnits = [0, 0.25, 0.5, 0.75, 1].map((f) => availableUnits! * f);
  // Four x ticks plus the origin, on whole days so the labels are real dates.
  const xTickDays = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(axisDays * f));

  // Whichever line hits zero first is the one that actually decides when the
  // power goes off, so it's the number promoted into the headline.
  const soonestDays =
    budgetDays !== null && actualDays !== null
      ? Math.min(budgetDays, actualDays)
      : budgetDays ?? actualDays;

  return (
    <View style={styles.card} onLayout={onLayout}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[typography.h2, styles.title]}>Credit runway</Text>
          <Text style={[typography.caption, styles.subtitle]}>
            {availableUnits!.toLocaleString()} units left · runs out in{" "}
            <Text style={styles.subtitleStrong}>{formatRunway(soonestDays!)}</Text>
          </Text>
        </View>
        <View style={styles.legend}>
          {budgetRate !== null && (
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: colors.indigo[500] }]} />
              <Text style={[typography.caption, styles.legendText]}>At budget</Text>
            </View>
          )}
          {actualRate !== null && (
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: colors.terracotta[500] }]} />
              <Text style={[typography.caption, styles.legendText]}>At recent use</Text>
            </View>
          )}
        </View>
      </View>

      {/* Width is only known after the first layout pass, and an SVG can't be
          laid out proportionally the way a flex row can -- so the frame
          reserves its height immediately and the plot draws on the next tick,
          instead of the card jumping in height once it measures. */}
      {width > 0 && (
        <Svg width={width} height={CHART_HEIGHT}>
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

          {xTickDays.map((days, i) => (
            <SvgText
              key={`xl${i}`}
              x={xFor(days)}
              y={CHART_HEIGHT - PAD_BOTTOM + 16}
              fill={colors.textSecondary}
              fontSize={10}
              textAnchor={i === 0 ? "start" : i === xTickDays.length - 1 ? "end" : "middle"}
            >
              {days === 0 ? "Today" : formatDayLabel(days)}
            </SvgText>
          ))}

          {actualRate !== null && actualDays !== null && (
            <Path
              d={lineFor(actualDays, actualRate)}
              stroke={colors.terracotta[500]}
              strokeWidth={2}
              strokeDasharray="5 4"
              fill="none"
            />
          )}
          {budgetRate !== null && budgetDays !== null && (
            <Path d={lineFor(budgetDays, budgetRate)} stroke={colors.indigo[500]} strokeWidth={2.5} fill="none" />
          )}

          {/* Zero-crossing markers: the actual answer to "when do I run out".
              Only drawn for a line that lands inside the axis -- a runway past
              MAX_AXIS_DAYS has no crossing to mark on this frame. */}
          {actualDays !== null && actualDays <= axisDays && (
            <Circle cx={xFor(actualDays)} cy={yFor(0)} r={4} fill={colors.terracotta[500]} />
          )}
          {budgetDays !== null && budgetDays <= axisDays && (
            <Circle cx={xFor(budgetDays)} cy={yFor(0)} r={4.5} fill={colors.indigo[500]} />
          )}
        </Svg>
      )}

      <View style={styles.footRow}>
        {budgetDays !== null && (
          <View style={styles.footItem}>
            <Text style={[typography.label, styles.footLabel]}>AT BUDGET</Text>
            <Text style={[typography.dataMd, styles.footValue]}>{formatRunway(budgetDays)}</Text>
            <Text style={[typography.dataXs, styles.footHint]}>
              {budgetRate!.toLocaleString(undefined, { maximumFractionDigits: 2 })} units/day
            </Text>
          </View>
        )}
        {actualDays !== null && (
          <View style={styles.footItem}>
            <Text style={[typography.label, styles.footLabel]}>AT RECENT USE</Text>
            <Text style={[typography.dataMd, styles.footValue]}>{formatRunway(actualDays)}</Text>
            <Text style={[typography.dataXs, styles.footHint]}>
              {actualRate!.toLocaleString(undefined, { maximumFractionDigits: 2 })} units/day avg
            </Text>
          </View>
        )}
      </View>
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
  subtitleStrong: { color: colors.textPrimary, fontWeight: "700" },
  legend: { gap: spacing.xs },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  legendSwatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { color: colors.textSecondary },
  empty: { color: colors.textSecondary },
  footRow: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.xs },
  footItem: { flex: 1, gap: 2 },
  footLabel: { color: colors.textSecondary },
  footValue: { color: colors.textPrimary },
  footHint: { color: colors.textSecondary },
});
