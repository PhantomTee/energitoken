import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Path, Line, Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { colors } from "../theme/colors";
import { typography, spacing } from "../theme/typography";
import { PowerPoint } from "../hooks/useConsumptionHistory";

const CHART_HEIGHT = 120;

/**
 * Live power-draw trace since this screen was opened -- an area line chart
 * plotting watts over time, redrawn as new readings arrive. There's no
 * persisted history to chart (Firebase only ever holds the meter's latest
 * snapshot), so this is a live/session view by design: it starts empty on
 * every visit and fills in as useConsumptionHistory accumulates readings.
 * Settled, longer-term consumption already has a home on the History tab.
 */
export function LiveConsumptionChart({ points, width }: { points: PowerPoint[]; width: number }) {
  const { linePath, areaPath, maxWatts, latestWatts } = useMemo(() => {
    if (points.length === 0 || width <= 0) {
      return { linePath: "", areaPath: "", maxWatts: 0, latestWatts: null as number | null };
    }

    const first = points[0].t;
    const last = points[points.length - 1].t;
    const span = Math.max(1, last - first);
    const peak = Math.max(...points.map((p) => p.watts), 1);
    // A little headroom above the peak so the trace doesn't hug the top edge.
    const scaleMax = peak * 1.15;

    const coords = points.map((p) => {
      const x = ((p.t - first) / span) * width;
      const y = CHART_HEIGHT - (p.watts / scaleMax) * CHART_HEIGHT;
      return { x, y };
    });

    const line = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
    const area = `${line} L ${coords[coords.length - 1].x.toFixed(1)} ${CHART_HEIGHT} L ${coords[0].x.toFixed(1)} ${CHART_HEIGHT} Z`;

    return { linePath: line, areaPath: area, maxWatts: peak, latestWatts: points[points.length - 1].watts };
  }, [points, width]);

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
      <Svg width={width} height={CHART_HEIGHT}>
        <Defs>
          <LinearGradient id="powerFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.terracotta[400]} stopOpacity={0.35} />
            <Stop offset="1" stopColor={colors.terracotta[400]} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <Line
            key={f}
            x1={0}
            x2={width}
            y1={CHART_HEIGHT * f}
            y2={CHART_HEIGHT * f}
            stroke={colors.border}
            strokeWidth={1}
          />
        ))}
        <Path d={areaPath} fill="url(#powerFill)" />
        <Path d={linePath} stroke={colors.terracotta[500]} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {latestWatts !== null && (
          <Circle
            cx={width}
            cy={CHART_HEIGHT - (latestWatts / (maxWatts * 1.15)) * CHART_HEIGHT}
            r={4}
            fill={colors.terracotta[500]}
          />
        )}
      </Svg>
      <View style={styles.axisRow}>
        <Text style={[typography.dataXs, styles.axisLabel]}>{formatAgo(points[0].t)}</Text>
        <Text style={[typography.dataXs, styles.axisLabel]}>now</Text>
      </View>
    </View>
  );
}

function formatAgo(t: number): string {
  const minutes = Math.round((Date.now() - t) / 60000);
  return minutes <= 0 ? "now" : `-${minutes}m`;
}

const styles = StyleSheet.create({
  axisRow: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs },
  axisLabel: { color: colors.textSecondary },
  empty: { alignItems: "center", justifyContent: "center" },
  emptyText: { color: colors.textSecondary },
});
