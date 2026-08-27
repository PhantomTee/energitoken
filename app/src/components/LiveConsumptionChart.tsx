import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Path, Line, Circle, Defs, LinearGradient, Stop, Text as SvgText } from "react-native-svg";
import { colors } from "../theme/colors";
import { typography, spacing } from "../theme/typography";
import { PowerPoint } from "../hooks/useConsumptionHistory";

const CHART_HEIGHT = 120;
const Y_AXIS_WIDTH = 40;   // reserved column for watt labels, left of the plot
const X_LABEL_COUNT = 4;   // evenly spaced time labels, including the endpoints

/** Rounds a watt value up to a "nice" gridline step (1/2/5 * 10^n) so axis
 * labels read like 50, 100, 150 instead of the raw 15%-headroom fractions
 * the plot itself is scaled to. */
function niceStep(roughStep: number): number {
  if (roughStep <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

/**
 * Live power-draw trace since this screen was opened -- an area line chart
 * plotting watts over time, redrawn as new readings arrive. There's no
 * persisted history to chart (Firebase only ever holds the meter's latest
 * snapshot), so this is a live/session view by design: it starts empty on
 * every visit and fills in as useConsumptionHistory accumulates readings.
 * Settled, longer-term consumption already has a home on the History tab.
 */
export function LiveConsumptionChart({ points, width }: { points: PowerPoint[]; width: number }) {
  const plotWidth = Math.max(0, width - Y_AXIS_WIDTH);

  const { linePath, areaPath, latestWatts, latestY, yTicks, xLabels } = useMemo(() => {
    if (points.length === 0 || plotWidth <= 0) {
      return {
        linePath: "",
        areaPath: "",
        latestWatts: null as number | null,
        latestY: 0,
        yTicks: [] as { value: number; y: number }[],
        xLabels: [] as { label: string; x: number }[],
      };
    }

    const firstT = points[0].t;
    const lastT = points[points.length - 1].t;
    const span = Math.max(1, lastT - firstT);
    const peak = Math.max(...points.map((p) => p.watts), 1);
    // A little headroom above the peak so the trace doesn't hug the top edge.
    const scaleMax = peak * 1.15;
    const step = niceStep(scaleMax / 4);
    const topTick = Math.ceil(scaleMax / step) * step;

    const yFor = (watts: number) => CHART_HEIGHT - (watts / topTick) * CHART_HEIGHT;

    const coords = points.map((p) => ({
      x: ((p.t - firstT) / span) * plotWidth,
      y: yFor(p.watts),
    }));

    const line = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
    const area = `${line} L ${coords[coords.length - 1].x.toFixed(1)} ${CHART_HEIGHT} L ${coords[0].x.toFixed(1)} ${CHART_HEIGHT} Z`;

    const ticks: { value: number; y: number }[] = [];
    for (let v = 0; v <= topTick + 0.001; v += step) ticks.push({ value: Math.round(v), y: yFor(v) });

    const labels: { label: string; x: number }[] = [];
    for (let i = 0; i < X_LABEL_COUNT; i++) {
      const t = firstT + (span * i) / (X_LABEL_COUNT - 1);
      labels.push({ label: formatAgo(t), x: (i / (X_LABEL_COUNT - 1)) * plotWidth });
    }

    return {
      linePath: line,
      areaPath: area,
      latestWatts: points[points.length - 1].watts,
      latestY: yFor(points[points.length - 1].watts),
      yTicks: ticks,
      xLabels: labels,
    };
  }, [points, plotWidth]);

  if (points.length < 2) {
    return (
      <View style={[styles.empty, { width, height: CHART_HEIGHT }]}>
        <Text style={[typography.caption, styles.emptyText]}>
          Watching for live readings…
        </Text>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.row}>
        <Svg width={Y_AXIS_WIDTH} height={CHART_HEIGHT}>
          {yTicks.map((tick) => (
            <SvgText
              key={tick.value}
              x={Y_AXIS_WIDTH - 6}
              y={Math.min(Math.max(tick.y, 9), CHART_HEIGHT - 2)}
              fontSize={9}
              fill={colors.textSecondary}
              textAnchor="end"
            >
              {tick.value}W
            </SvgText>
          ))}
        </Svg>
        <Svg width={plotWidth} height={CHART_HEIGHT}>
          <Defs>
            <LinearGradient id="powerFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.terracotta[400]} stopOpacity={0.35} />
              <Stop offset="1" stopColor={colors.terracotta[400]} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {yTicks.map((tick) => (
            <Line
              key={tick.value}
              x1={0}
              x2={plotWidth}
              y1={tick.y}
              y2={tick.y}
              stroke={colors.border}
              strokeWidth={1}
            />
          ))}
          <Path d={areaPath} fill="url(#powerFill)" />
          <Path d={linePath} stroke={colors.terracotta[500]} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          {latestWatts !== null && <Circle cx={plotWidth} cy={latestY} r={4} fill={colors.terracotta[500]} />}
        </Svg>
      </View>
      <View style={[styles.axisRow, { marginLeft: Y_AXIS_WIDTH, width: plotWidth }]}>
        {xLabels.map((l, i) => (
          <Text
            key={i}
            style={[
              typography.dataXs,
              styles.axisLabel,
              i === 0 && styles.axisLabelStart,
              i === xLabels.length - 1 && styles.axisLabelEnd,
            ]}
          >
            {l.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

function formatAgo(t: number): string {
  const minutes = Math.round((Date.now() - t) / 60000);
  return minutes <= 0 ? "now" : `-${minutes}m`;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  axisRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs },
  axisLabel: { color: colors.textSecondary, flex: 1, textAlign: "center" },
  axisLabelStart: { textAlign: "left" },
  axisLabelEnd: { textAlign: "right" },
  empty: { alignItems: "center", justifyContent: "center" },
  emptyText: { color: colors.textSecondary },
});
