import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, LayoutChangeEvent, ActivityIndicator } from "react-native";
import Svg, { Path, Line, Defs, LinearGradient, Stop, Text as SvgText, Circle } from "react-native-svg";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { ConsumptionSample, describeDayKey, watDayKey } from "../hooks/useConsumptionLog";

/**
 * The household's consumption over one West Africa Time day.
 *
 * Replaces a live chart that plotted a ten-minute in-memory buffer against a
 * relative axis reading "-8m ... now". That axis could only ever answer "how
 * much am I drawing this instant", and the buffer emptied on leaving the
 * screen, so there was no way to ask what the morning looked like, let alone
 * yesterday. This plots the meter's own logged series against real clock
 * time, so a point on the chart corresponds to a time of day the household
 * actually recognises.
 *
 * Three things it deliberately does not do:
 *
 *  - It does not interpolate across gaps. A meter that was offline has no
 *    samples for those minutes, and joining the ends would draw a confident
 *    straight line through hours nobody measured. Gaps are left as breaks.
 *  - It does not scale the x axis to the data. The day is always drawn from
 *    00:00, so the shape of one day is directly comparable with another and
 *    a late start reads as a late start rather than as a full day.
 *  - It does not plot the spot readings. Once-a-minute instantaneous samples
 *    alias badly against appliances that cycle; the line is average power
 *    per interval, derived from the meter's energy counter, which cannot
 *    miss a load that ran entirely between two samples.
 */

const CHART_HEIGHT = 200;
const PAD_LEFT = 46;
const PAD_RIGHT = 14;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;

/** Minutes between consecutive samples beyond which the meter is considered
 * to have been down, and the line is broken rather than joined. Samples are
 * written once a minute, so anything past a few minutes is a real outage. */
const GAP_MINUTES = 5;

const MINUTES_PER_DAY = 1440;

/** Rounds up to a "nice" axis maximum (1/2/5 x 10^n) so gridline labels read
 * as 200 / 400 / 600 rather than as fractions of an arbitrary peak. */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

function clockLabel(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function watts(w: number): string {
  if (w >= 1000) return `${(w / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}kW`;
  return `${Math.round(w)}W`;
}

function energy(wh: number): string {
  if (wh >= 1000) return `${(wh / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} kWh`;
  return `${Math.round(wh)} Wh`;
}

/** Current minute of the day in WAT, for the "now" marker and axis extent. */
function watMinuteNow(): number {
  const wat = new Date(Date.now() + 60 * 60 * 1000);
  return wat.getUTCHours() * 60 + wat.getUTCMinutes();
}

export function ConsumptionChart({
  day,
  samples,
  totalWh,
  peakW,
  loading,
  onPrevDay,
  onNextDay,
}: {
  day: string;
  samples: ConsumptionSample[];
  totalWh: number;
  peakW: number;
  loading: boolean;
  onPrevDay: () => void;
  onNextDay: () => void;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const isToday = day === watDayKey();
  const nowMinute = watMinuteNow();

  const plot = useMemo(() => {
    const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
    const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

    // Today is drawn only as far as the clock has actually reached, so the
    // line ends at the present moment instead of trailing into empty hours
    // that have not happened yet. A past day is drawn whole.
    const xMax = isToday ? Math.max(60, Math.min(MINUTES_PER_DAY, Math.ceil((nowMinute + 1) / 60) * 60)) : MINUTES_PER_DAY;

    const peak = samples.reduce((m, s) => Math.max(m, s.avgW), 0);
    const yMax = niceCeil(Math.max(peak * 1.15, 50));

    const xFor = (minute: number) => PAD_LEFT + (Math.min(minute, xMax) / xMax) * plotW;
    const yFor = (w: number) => PAD_TOP + (1 - Math.min(w, yMax) / yMax) * plotH;

    // Split into runs of contiguous samples so an outage becomes a break in
    // the line rather than a straight line drawn through it.
    const runs: ConsumptionSample[][] = [];
    let current: ConsumptionSample[] = [];
    samples.forEach((s, i) => {
      if (i > 0 && s.minute - samples[i - 1].minute > GAP_MINUTES) {
        if (current.length) runs.push(current);
        current = [];
      }
      current.push(s);
    });
    if (current.length) runs.push(current);

    const linePaths = runs.map((run) =>
      run
        .map((s, i) => `${i === 0 ? "M" : "L"} ${xFor(s.minute).toFixed(1)} ${yFor(s.avgW).toFixed(1)}`)
        .join(" ")
    );

    // Only runs with real width get a filled area; a lone sample would
    // otherwise render as an invisible zero-width sliver.
    const areaPaths = runs
      .filter((run) => run.length > 1)
      .map((run) => {
        const base = yFor(0);
        const head = run
          .map((s, i) => `${i === 0 ? "M" : "L"} ${xFor(s.minute).toFixed(1)} ${yFor(s.avgW).toFixed(1)}`)
          .join(" ");
        const lastX = xFor(run[run.length - 1].minute).toFixed(1);
        const firstX = xFor(run[0].minute).toFixed(1);
        return `${head} L ${lastX} ${base} L ${firstX} ${base} Z`;
      });

    // Aim for four to six labelled hours, whatever the span.
    const stepChoices = [60, 120, 180, 240, 360, 720];
    const xStep = stepChoices.find((s) => xMax / s <= 6) ?? 720;
    const xTicks: number[] = [];
    for (let m = 0; m <= xMax; m += xStep) xTicks.push(m);

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f);

    const last = samples.length ? samples[samples.length - 1] : null;

    return { plotW, plotH, xMax, yMax, xFor, yFor, linePaths, areaPaths, xTicks, yTicks, last };
  }, [width, samples, isToday, nowMinute]);

  const hasData = samples.length > 1;

  return (
    <View style={styles.card} onLayout={onLayout}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[typography.h2, styles.title]}>Consumption</Text>
          <Text style={[typography.caption, styles.subtitle]}>
            {hasData
              ? `${energy(totalWh)} used · peak ${watts(peakW)}`
              : "Logged by the meter every minute"}
          </Text>
        </View>
        <View style={styles.nav}>
          <Pressable onPress={onPrevDay} style={styles.navBtn} hitSlop={8}>
            <Text style={styles.navIcon}>{"‹"}</Text>
          </Pressable>
          <Text style={[typography.caption, styles.dayLabel]}>{describeDayKey(day)}</Text>
          <Pressable
            onPress={onNextDay}
            disabled={isToday}
            style={[styles.navBtn, isToday && styles.navBtnDisabled]}
            hitSlop={8}
          >
            <Text style={[styles.navIcon, isToday && styles.navIconDisabled]}>{"›"}</Text>
          </Pressable>
        </View>
      </View>

      {loading && !hasData ? (
        <View style={styles.placeholder}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : !hasData ? (
        <View style={styles.placeholder}>
          <Text style={[typography.caption, styles.emptyText]}>
            {isToday
              ? "No readings logged yet today. The meter records one sample a minute once it is powered and online."
              : "The meter logged no readings on this day."}
          </Text>
        </View>
      ) : (
        width > 0 && (
          <Svg width={width} height={CHART_HEIGHT}>
            <Defs>
              <LinearGradient id="consumptionFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.terracotta[500]} stopOpacity={0.32} />
                <Stop offset="1" stopColor={colors.terracotta[500]} stopOpacity={0.02} />
              </LinearGradient>
            </Defs>

            {plot.yTicks.map((w, i) => (
              <Line
                key={`gy${i}`}
                x1={PAD_LEFT}
                x2={PAD_LEFT + plot.plotW}
                y1={plot.yFor(w)}
                y2={plot.yFor(w)}
                stroke={colors.border}
                strokeWidth={1}
              />
            ))}
            {plot.yTicks.map((w, i) => (
              <SvgText
                key={`ly${i}`}
                x={PAD_LEFT - 7}
                y={plot.yFor(w) + 3.5}
                fill={colors.textSecondary}
                fontSize={10}
                textAnchor="end"
              >
                {i === 0 ? "0" : watts(w)}
              </SvgText>
            ))}

            {plot.xTicks.map((m) => (
              <SvgText
                key={`lx${m}`}
                x={plot.xFor(m)}
                y={CHART_HEIGHT - PAD_BOTTOM + 16}
                fill={colors.textSecondary}
                fontSize={10}
                textAnchor={m === 0 ? "start" : m >= plot.xMax ? "end" : "middle"}
              >
                {clockLabel(m)}
              </SvgText>
            ))}

            {plot.areaPaths.map((d, i) => (
              <Path key={`a${i}`} d={d} fill="url(#consumptionFill)" />
            ))}
            {plot.linePaths.map((d, i) => (
              <Path
                key={`p${i}`}
                d={d}
                stroke={colors.terracotta[500]}
                strokeWidth={2}
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {/* Where the present moment sits on the axis, so a partial day
                reads as in-progress rather than as one that simply stopped. */}
            {isToday && (
              <Line
                x1={plot.xFor(nowMinute)}
                x2={plot.xFor(nowMinute)}
                y1={PAD_TOP}
                y2={PAD_TOP + plot.plotH}
                stroke={colors.neutral[700]}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}
            {isToday && plot.last && plot.last.minute >= nowMinute - GAP_MINUTES && (
              <Circle
                cx={plot.xFor(plot.last.minute)}
                cy={plot.yFor(plot.last.avgW)}
                r={3.5}
                fill={colors.terracotta[500]}
              />
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
  nav: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  navBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.neutral[100],
  },
  navBtnDisabled: { opacity: 0.35 },
  navIcon: { color: colors.textPrimary, fontSize: 18, lineHeight: 22 },
  navIconDisabled: { color: colors.textSecondary },
  dayLabel: { color: colors.textPrimary, minWidth: 78, textAlign: "center" },
  placeholder: { height: CHART_HEIGHT, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  emptyText: { color: colors.textSecondary, textAlign: "center" },
});
