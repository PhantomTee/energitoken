import React, { useState } from "react";
import { View, Text, StyleSheet, LayoutChangeEvent } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { unitsToWh } from "../services/units";

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
/** Everything between the card's outer edge and its content: the padding on
 * each side plus the 1px border. onLayout reports the outer width, so all of
 * it has to come off before the SVG is sized, or the chart is drawn wider
 * than the space it has and runs past the card edge -- unnoticeable on a wide
 * screen, off the edge on a phone. Taken from the same constants the
 * stylesheet uses so the two cannot drift apart. */
const CARD_INSET = spacing.lg + 1;
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
  /**
   * onLayout reports the CARD's width, which includes its own horizontal
   * padding on both sides. Drawing the SVG at that width inside the padded
   * box made the chart wider than the space available to it, so it overflowed
   * the card by two paddings -- visible on a phone, where there is no slack to
   * absorb it, and hidden on a wide screen.
   */
  const onLayout = (e: LayoutChangeEvent) =>
    setWidth(Math.max(0, e.nativeEvent.layout.width - CARD_INSET * 2));

  const hasBudget = budgetUnitsPerDay !== null && budgetUnitsPerDay > 0;

  /**
   * At most a week of bars, whatever period the screen is set to.
   *
   * The card used to draw one bar per day of the selected period, so choosing
   * 30 days produced thirty bars a few pixels wide with most labels dropped --
   * unreadable on a phone, and useless for the thing bars are actually good
   * at, which is letting someone point at one day and recognise it. The long
   * view belongs to the Consumption chart's Month range, which is built for
   * it. This card answers "how did this week go".
   */
  const week = days.slice(-7);

  /**
   * Everything on this card was expressed in units, where one unit is a
   * kilowatt-hour. A household drawing tens of watt-hours a day therefore read
   * every bar, the axis and its own allowance as a three-decimal fraction of
   * nothing -- 0.031 units -- which made a working chart look broken. The
   * scale now follows the data, exactly as the consumption chart does.
   */
  const dayWh = week.map((d) => d.wh);
  const allowanceWh = hasBudget ? unitsToWh(budgetUnitsPerDay!) : null;
  const worstDay = dayWh.length > 0 ? Math.max(...dayWh) : 0;
  const anyUsage = worstDay > 0;
  const useKwh = Math.max(worstDay, allowanceWh ?? 0) >= 2000;
  const scale = (wh: number) => (useKwh ? wh / 1000 : wh);
  const unitLabel = useKwh ? "kWh" : "Wh";
  const fmt = (wh: number) => {
    const v = scale(wh);
    return v >= 100 ? Math.round(v).toString() : v.toFixed(v >= 10 ? 0 : 1);
  };

  /**
   * The verdict, stated rather than left to be worked out. Reading this chart
   * used to mean decoding a legend, mapping two colours onto bars, finding a
   * faint dashed line and comparing seven heights against it. The chart should
   * do that work; the bars are then evidence for a sentence, not a puzzle.
   */
  const daysOver = allowanceWh == null ? 0 : dayWh.filter((wh) => wh > allowanceWh).length;
  const daysWithin = dayWh.length - daysOver;

  /**
   * Direction of travel: the most recent completed day against the average of
   * the ones before it. Today is excluded because it is still accumulating --
   * comparing a part-day against full days always reads as a fall.
   */
  const completed = dayWh.slice(0, -1);
  const latest = completed.length > 0 ? completed[completed.length - 1] : null;
  const earlier = completed.slice(0, -1);
  const earlierAvg =
    earlier.length > 0 ? earlier.reduce((a, b) => a + b, 0) / earlier.length : null;
  const trendPct =
    latest != null && earlierAvg != null && earlierAvg > 0
      ? ((latest - earlierAvg) / earlierAvg) * 100
      : null;
  // Under five percent is noise on a household load, not a trend.
  const trend: "up" | "down" | "flat" | null =
    trendPct == null ? null : trendPct > 5 ? "up" : trendPct < -5 ? "down" : "flat";
  const trendArrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  const trendColor =
    trend === "up" ? colors.terracotta[500] : trend === "down" ? colors.success : colors.textSecondary;

  // Headroom above the taller of (worst day, allowance) so the peak bar and
  // the allowance line both sit inside the frame rather than on its edge.
  const yMax = Math.max(worstDay, allowanceWh ?? 0) * 1.15 || 1;

  const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const yFor = (wh: number) => PAD_TOP + (1 - wh / yMax) * plotH;

  const slot = week.length > 0 ? plotW / week.length : 0;
  const barW = slot * (1 - BAR_GAP_RATIO);
  const labelEvery = Math.max(1, Math.ceil(week.length / MAX_LABELS));

  const gridWh = [0, 0.5, 1].map((f) => yMax * f);

  const totalWh = dayWh.reduce((sum, w) => sum + w, 0);

  return (
    <View style={styles.card} onLayout={onLayout}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[typography.h2, styles.title]}>This week's use</Text>
          <Text style={[typography.bodyStrong, styles.verdict]}>
            {!anyUsage
              ? "No usage measured yet this week"
              : hasBudget
                ? `Within your allowance on ${daysWithin} of ${dayWh.length} day${dayWh.length === 1 ? "" : "s"}`
                : `${fmt(totalWh)} ${unitLabel} used over ${dayWh.length} day${dayWh.length === 1 ? "" : "s"}`}
          </Text>
          {anyUsage && (
            <Text style={[typography.caption, styles.subtitle]}>
              {hasBudget ? `${fmt(totalWh)} ${unitLabel} in total` : "Set a budget to compare against an allowance"}
            </Text>
          )}
        </View>
        {/* Direction of travel, in place of the legend the colours used to
            need. With the verdict stated in words above, the bar colours are
            reinforcement rather than something to decode. */}
        {trend !== null && (
          <View style={styles.trend}>
            <Text style={[typography.dataMd, { color: trendColor }]}>{trendArrow}</Text>
            <Text style={[typography.caption, styles.trendLabel]}>
              {trend === "flat"
                ? "steady"
                : `${Math.abs(Math.round(trendPct!))}% ${trend === "up" ? "higher" : "lower"}`}
            </Text>
            <Text style={[typography.caption, styles.trendSub]}>vs earlier days</Text>
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
            {gridWh.map((wh, i) => (
              <Line
                key={`g${i}`}
                x1={PAD_LEFT}
                y1={yFor(wh)}
                x2={PAD_LEFT + plotW}
                y2={yFor(wh)}
                stroke={colors.border}
                strokeWidth={1}
              />
            ))}
            {gridWh.map((wh, i) => (
              <SvgText
                key={`gl${i}`}
                x={PAD_LEFT - 6}
                y={yFor(wh) + 4}
                fill={colors.textSecondary}
                fontSize={10}
                textAnchor="end"
              >
                {i === 0 ? "0" : fmt(wh)}
              </SvgText>
            ))}

            {week.map((day, i) => {
              const wh = dayWh[i];
              const over = allowanceWh != null && wh > allowanceWh;
              const x = PAD_LEFT + i * slot + (slot - barW) / 2;
              // A day with real-but-tiny usage still gets a visible sliver --
              // otherwise "used a little" and "used nothing" look the same.
              const top = wh > 0 ? Math.min(yFor(wh), yFor(0) - 2) : yFor(0);
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
            {allowanceWh != null && <Line
              x1={PAD_LEFT}
              y1={yFor(allowanceWh)}
              x2={PAD_LEFT + plotW}
              y2={yFor(allowanceWh)}
              stroke={colors.neutral[700]}
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />}
            {/* Named AND valued on the line itself. It previously read
                "allowance" in grey at the end of a hairline, which says
                neither what it is nor what it is set to. */}
            {allowanceWh != null && (
              <SvgText
                x={PAD_LEFT + plotW}
                y={yFor(allowanceWh) - 5}
                fill={colors.neutral[700]}
                fontSize={10}
                textAnchor="end"
              >
                {`Allowance ${fmt(allowanceWh)} ${unitLabel}/day`}
              </SvgText>
            )}

            {week.map((day, i) =>
              i % labelEvery === 0 || i === week.length - 1 ? (
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
  // The verdict carries the meaning the legend used to; the trend block
  // replaces it in the same corner.
  verdict: { color: colors.textPrimary },
  trend: { alignItems: "flex-end", minWidth: 84 },
  trendLabel: { color: colors.textPrimary, fontWeight: "600" },
  trendSub: { color: colors.textSecondary },
  empty: { color: colors.textSecondary },
});
