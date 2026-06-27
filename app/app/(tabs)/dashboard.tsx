import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { colors } from "../../src/theme/colors";
import { typography, spacing, radius } from "../../src/theme/typography";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { MetricTile } from "../../src/components/MetricTile";
import { BudgetRing } from "../../src/components/BudgetRing";
import { RelayIndicator } from "../../src/components/RelayIndicator";
import { LiveMockBanner } from "../../src/components/LiveMockBanner";
import { mockMeterReadingA, mockMeterReadingB } from "../../src/mock/mockMeterData";
import { useWallet } from "../../src/hooks/useWallet";
import { TopUpModal } from "../../src/components/TopUpModal";
import { getEngyBalance } from "../../src/services/contract";

/**
 * Mock-only meter data for now (build Step 4). Step 6 swaps the static
 * readings below for a real Firebase realtime listener behind the same mode
 * toggle. The token balance below is real — read live from the contract.
 */
export default function DashboardScreen() {
  const [mode, setMode] = useState<"mock" | "live">("mock");
  const reading = mode === "live" ? mockMeterReadingB : mockMeterReadingA;
  const { walletAddress, logout } = useWallet();
  const [topUpVisible, setTopUpVisible] = useState(false);
  const [balanceWh, setBalanceWh] = useState<bigint | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!walletAddress) return;
      let cancelled = false;
      getEngyBalance(walletAddress)
        .then((balance) => {
          if (!cancelled) setBalanceWh(balance);
        })
        .catch(() => {
          // leave the previous balance on screen rather than clearing it on a transient RPC error
        });
      return () => {
        cancelled = true;
      };
    }, [walletAddress])
  );

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <AdinkraAccent size={32} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
          <Text style={[typography.h2, styles.brandWordmark]}>ENERGITOKEN</Text>
        </View>
        {walletAddress && (
          <Pressable onPress={handleLogout} style={styles.walletChip}>
            <Text style={[typography.dataXs, styles.walletAddress]}>
              {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
            </Text>
            <Text style={[typography.caption, styles.logOut]}>Log out</Text>
          </Pressable>
        )}
      </View>

      <LiveMockBanner mode={mode} onToggle={setMode} />

      <View style={styles.balanceCard}>
        <View style={styles.balanceMain}>
          <Text style={[typography.label, styles.balanceLabel]}>Available credit</Text>
          <Text style={[typography.data, styles.balanceValue]}>
            {balanceWh === null ? "···" : balanceWh.toLocaleString()}
          </Text>
          <Text style={[typography.dataSm, styles.balanceUnit]}>Wh · ENGY on Polygon Amoy</Text>
          {walletAddress && (
            <Pressable style={styles.topUpButton} onPress={() => setTopUpVisible(true)}>
              <Text style={[typography.bodyStrong, styles.topUpButtonText]}>Top up with OPay</Text>
            </Pressable>
          )}
        </View>
        <BudgetRing percentUsed={reading.percentUsed} size={96} />
      </View>

      <View style={styles.tileRow}>
        <MetricTile label="Voltage" value={reading.voltage.toFixed(1)} unit="V" />
        <MetricTile label="Current" value={reading.current.toFixed(1)} unit="A" />
        <MetricTile label="Power" value={reading.power.toFixed(0)} unit="W" />
      </View>

      <Text style={[typography.h2, styles.sectionTitle]}>Load priority</Text>
      <RelayIndicator relays={reading.relays} />

      {walletAddress && (
        <TopUpModal visible={topUpVisible} onClose={() => setTopUpVisible(false)} walletAddress={walletAddress} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandWordmark: { color: colors.textPrimary, letterSpacing: 0.5 },
  walletChip: { alignItems: "flex-end" },
  walletAddress: { color: colors.textPrimary },
  logOut: { color: colors.textSecondary, textDecorationLine: "underline", marginTop: 2 },
  balanceCard: {
    backgroundColor: colors.panelInset,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  balanceMain: { flex: 1, marginRight: spacing.md },
  balanceLabel: { color: colors.terracotta[500] },
  balanceValue: { color: colors.panelInsetText, marginTop: spacing.xs },
  balanceUnit: { color: colors.indigo[700], marginTop: 2 },
  topUpButton: {
    backgroundColor: colors.terracotta[500],
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
    marginTop: spacing.md,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
  },
  topUpButtonText: { color: colors.neutral.white },
  tileRow: { flexDirection: "row", gap: spacing.sm },
  sectionTitle: { color: colors.textPrimary, marginTop: spacing.sm },
});
