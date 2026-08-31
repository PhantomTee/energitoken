import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, LayoutChangeEvent, ActivityIndicator } from "react-native";
import Svg, { Path, Line, Defs, LinearGradient, Stop, Text as SvgText, Circle } from "react-native-svg";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import {
  ConsumptionPoint,
  ConsumptionRange,
  CONSUMPTION_RANGES,
  RANGE_LABELS,
} from "../hooks/useConsumptionLog";

/**
 * The household's power draw over a chosen window.
 *
 * Replaces a live chart that plotted a ten-minute in-memory buffer against a
 * relative axis reading "-8m ... now". That could only answer "how much am I
 * drawing this instant", and the buffer emptied on leaving the screen, so
 * there was no way to ask what the morning looked like, let alone last week.
 * This plots the meter's own logged series against real clock time.
 *
 * Two things it deliberately does not do:
 *
 *  - It does not interpolate across gaps. A meter that was offline has no
 *    samples for those buckets, and joining the ends would draw a confident
 *    straight line through hours nobody measured.
 *  - It does not plot the instantaneous readings. A once-a-minute spot
 *    sample aliases badly against appliances that cycle; the line is average
 *    power per bucket, derived from the meter's energy counter, which cannot
 *    miss a load that ran entirely between two samples.
 */

const CHART_HEIGHT = 200;
const PAD_LEFT = 46;
const PAD_RIGHT = 14;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;

/** A gap wider than this many buckets means the meter was down, and the line
 * is broken rather than joined across it. */
const GAP_BUCKETS = 3;

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

function watts(w: number): string {
  if (w >= 1000) return `${(w / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}kW`;
  return `${Math.round(w)}W`;
}

function energy(wh: number): string {
  if (wh >= 1000) return `${(wh / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} kWh`;
  return `${Math.round(wh)} Wh`;
}

const WAT_OFFSET_MS = 60 * 60 * 1000;

/** Axis labels in West Africa Time, the zone the meter itself keys its log
 * by -- so a tick reading 06:00 is the same 06:00 the household experienced,
 * regardless of the phone's own timezone. */
function axisLabel(t: number, range: ConsumptionRange): string {
  const d = new Date(t + WAT_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  if (range === "7d" || range === "14d") {
    const day = d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
    return range === "14d"
      ? `${d.getUTCDate()}/${d.getUTCMonth() + 1}`
      : `${day} ${hh}:00`.replace(" 00:00", "");
  }
  return `${hh}:${mm}`;
}

export function ConsumptionChart({
  range,
  onRangeChange,
  points,
  totalWh,
  peakW,
  startMs,
  endMs,
  bucketMin,
  loading,
}: {
  range: ConsumptionRange;
  onRangeChange: (r: ConsumptionRange) => void;
  points: ConsumptionPoint[];
  totalWh: number;
  peakW: number;
  startMs: number;
  endMs: number;
  bucketMin: number;
  loading: boolean;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const plot = useMemo(() => {
    const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
    const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
    const span = Math.max(1, endMs - startMs);

    const peak = points.reduce((m, p) => Math.max(m, p.avgW), 0);
    const yMax = niceCeil(Math.max(peak * 1.15, 50));

    const xFor = (t: number) => PAD_LEFT + ((t - startMs) / span) * plotW;
    const yFor = (w: number) => PAD_TOP + (1 - Math.min(w, yMax) / yMax) * plotH;

    // Break the line wherever the meter went quiet for more than a few
    // buckets, so an outage reads as an outage.
    const gapMs = bucketMin * 60_000 * GAP_BUCKETS;
    const runs: ConsumptionPoint[][] = [];
    let current: ConsumptionPoint[] = [];
    points.forEach((p, i) => {
      if (i > 0 && p.t - points[i - 1].t > gapMs) {
        if (current.length) runs.push(current);
        current = [];
      }
      current.push(p);
    });
    if (current.length) runs.push(current);

    const linePaths = runs.map((run) =>
      run.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.t).toFixed(1)} ${yFor(p.avgW).toFixed(1)}`).join(" ")
    );
    const areaPaths = runs
      .filter((run) => run.length > 1)
      .map((run) => {
        const base = yFor(0);
        const head = run
          .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.t).toFixed(1)} ${yFor(p.avgW).toFixed(1)}`)
          .join(" ");
        return `${head} L ${xFor(run[run.length - 1].t).toFixed(1)} ${base} L ${xFor(run[0].t).toFixed(1)} ${base} Z`;
      });

    const TICKS = 5;
    const xTicks = Array.from({ length: TICKS }, (_, i) => startMs + (span * i) / (TICKS - 1));
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f);

    return { plotW, plotH, yMax, xFor, yFor, linePaths, areaPaths, xTicks, yTicks };
  }, [width, points, startMs, endMs, bucketMin]);

  const hasData = points.length > 1;
  const last = points.length ? points[points.length - 1] : null;

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
      </View>

      <View style={styles.rangeRow}>
        {CONSUMPTION_RANGES.map((r) => (
          <Pressable
            key={r}
            onPress={() => onRangeChange(r)}
            style={[styles.rangeChip, r === range && styles.rangeChipActive]}
          >
            <Text style={[typography.caption, r === range ? styles.rangeTextActive : styles.rangeText]}>
              {RANGE_LABELS[r]}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading && !hasData ? (
        <View style={styles.placeholder}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : !hasData ? (
        <View style={styles.placeholder}>
          <Text style={[typography.caption, styles.emptyText]}>
            No readings logged in this window. The meter records one sample a minute once it is
            powered and online.
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

            {plot.xTicks.map((t, i) => (
              <SvgText
                key={`lx${i}`}
                x={plot.xFor(t)}
                y={CHART_HEIGHT - PAD_BOTTOM + 16}
                fill={colors.textSecondary}
                fontSize={10}
                textAnchor={i === 0 ? "start" : i === plot.xTicks.length - 1 ? "end" : "middle"}
              >
                {axisLabel(t, range)}
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
            {last && (
              <Circle cx={plot.xFor(last.t)} cy={plot.yFor(last.avgW)} r={3.5} fill={colors.terracotta[500]} />
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
  rangeRow: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  rangeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.neutral[100],
  },
  rangeChipActive: { backgroundColor: colors.terracotta[500] },
  rangeText: { color: colors.textSecondary },
  rangeTextActive: { color: colors.neutral.white },
  placeholder: { height: CHART_HEIGHT, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  emptyText: { color: colors.textSecondary, textAlign: "center" },
});
