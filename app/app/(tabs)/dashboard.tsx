import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { colors } from "../../src/theme/colors";
import { typography, spacing, radius } from "../../src/theme/typography";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { MetricTile } from "../../src/components/MetricTile";
import { BudgetRing } from "../../src/components/BudgetRing";
import { RelayIndicator } from "../../src/components/RelayIndicator";
import { LiveMockBanner } from "../../src/components/LiveMockBanner";
import { mockMeterReadingA, mockMeterReadingB } from "../../src/mock/mockMeterData";

/**
 * Mock-only for now (build Step 4). Step 6 swaps the static readings below
 * for a real Firebase realtime listener behind the same mode toggle.
 */
export default function DashboardScreen() {
  const [mode, setMode] = useState<"mock" | "live">("mock");
  const reading = mode === "live" ? mockMeterReadingB : mockMeterReadingA;
  const tokenBalanceWh = 9800; // placeholder; wired to on-chain balanceOf() in Step 7

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={[typography.label, styles.brandLabel]}>ENERGITOKEN</Text>
          <Text style={[typography.h1, styles.headerTitle]}>Your household</Text>
        </View>
        <AdinkraAccent size={48} color={colors.indigo[500]} opacity={0.18} />
      </View>

      <LiveMockBanner mode={mode} onToggle={setMode} />

      <View style={styles.ringWrap}>
        <BudgetRing percentUsed={reading.percentUsed} />
      </View>

      <View style={styles.tileRow}>
        <MetricTile label="Voltage" value={reading.voltage.toFixed(1)} unit="V" />
        <MetricTile label="Current" value={reading.current.toFixed(1)} unit="A" />
        <MetricTile label="Power" value={reading.power.toFixed(0)} unit="W" />
      </View>

      <Text style={[typography.h2, styles.sectionTitle]}>Load priority</Text>
      <RelayIndicator relays={reading.relays} />

      <View style={styles.balanceCard}>
        <Text style={[typography.label, styles.balanceLabel]}>Available credit</Text>
        <Text style={[typography.display, styles.balanceValue]}>{tokenBalanceWh.toLocaleString()} Wh</Text>
        <Text style={[typography.caption, styles.balanceCaption]}>ENGY balance on Polygon Amoy</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brandLabel: { color: colors.terracotta[500], marginBottom: spacing.xs },
  headerTitle: { color: colors.textPrimary },
  ringWrap: { alignItems: "center", paddingVertical: spacing.md },
  tileRow: { flexDirection: "row", gap: spacing.sm },
  sectionTitle: { color: colors.textPrimary, marginTop: spacing.sm },
  balanceCard: {
    backgroundColor: colors.indigo[900],
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
  balanceLabel: { color: colors.indigo[100] },
  balanceValue: { color: colors.neutral.white, marginTop: spacing.xs },
  balanceCaption: { color: colors.indigo[100], opacity: 0.8, marginTop: spacing.xs },
});
