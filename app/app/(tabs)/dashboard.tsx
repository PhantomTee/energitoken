import React, { useState, useCallback, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { router, useFocusEffect, Link } from "expo-router";
import { colors } from "../../src/theme/colors";
import { typography, spacing, radius } from "../../src/theme/typography";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { MetricTile } from "../../src/components/MetricTile";
import { BudgetRing } from "../../src/components/BudgetRing";
import { RelayIndicator } from "../../src/components/RelayIndicator";
import { LiveMockBanner } from "../../src/components/LiveMockBanner";
import { useWallet } from "../../src/hooks/useWallet";
import { TopUpModal } from "../../src/components/TopUpModal";
import { getEngyBalance } from "../../src/services/contract";
import { useMeterData, MeterMode } from "../../src/hooks/useMeterData";
import { writeDirectoryEntry } from "../../src/services/directory";
import { tokensToUnits } from "../../src/services/units";

export default function DashboardScreen() {
  const [mode, setMode] = useState<MeterMode>("mock");
  const { walletAddress, email, logout } = useWallet();
  const [topUpVisible, setTopUpVisible] = useState(false);
  const [balanceWh, setBalanceWh] = useState<bigint | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const {
    reading,
    loading: meterLoading,
    error: meterError,
    hasDevice,
  } = useMeterData(walletAddress, mode);

  const refreshBalance = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const balance = await getEngyBalance(walletAddress);
      setBalanceWh(balance);
    } catch {
      // leave the previous balance on screen rather than clearing it on a transient RPC error
    }
  }, [walletAddress]);

  useFocusEffect(
    useCallback(() => {
      refreshBalance();
    }, [refreshBalance])
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshBalance();
    setRefreshing(false);
  }, [refreshBalance]);

  // Lets the Transfer screen resolve "send to this email" to this wallet.
  useEffect(() => {
    if (walletAddress && email) {
      writeDirectoryEntry(email, walletAddress).catch(() => {
        // non-critical: the user can still be reached by raw wallet address
      });
    }
  }, [walletAddress, email]);

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.indigo[400]}
          colors={[colors.indigo[400]]}
        />
      }
    >
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
            {balanceWh === null ? "···" : tokensToUnits(balanceWh).toLocaleString()}
          </Text>
          <Text style={[typography.dataSm, styles.balanceUnit]}>units · 1 unit = 1 kWh</Text>
          {walletAddress && (
            <Pressable style={styles.topUpButton} onPress={() => setTopUpVisible(true)}>
              <Text style={[typography.bodyStrong, styles.topUpButtonText]}>Top up with OPay</Text>
            </Pressable>
          )}
        </View>
        <BudgetRing percentUsed={reading?.percentUsed ?? 0} size={96} />
      </View>

      {mode === "live" && (
        <View style={styles.meterStatusRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: meterError ? colors.danger : hasDevice ? colors.success : colors.warning },
            ]}
          />
          <Text style={[typography.caption, styles.meterStatusText]}>
            {meterLoading
              ? "Loading live meter data…"
              : meterError
                ? `Couldn't load live data: ${meterError}`
                : !hasDevice
                  ? "No device paired yet"
                  : reading
                    ? "Live"
                    : "Device paired — waiting for first reading"}
          </Text>
          {meterLoading && <ActivityIndicator color={colors.indigo[400]} style={styles.meterStatusSpinner} />}
          {!meterLoading && !hasDevice && (
            <Link href="/onboarding" style={styles.pairLink}>
              <Text style={[typography.dataXs, styles.pairLinkText]}>Pair a device →</Text>
            </Link>
          )}
        </View>
      )}

      <View style={styles.tileRow}>
        <MetricTile label="Voltage" value={reading ? reading.voltage.toFixed(1) : "—"} unit="V" />
        <MetricTile label="Current" value={reading ? reading.current.toFixed(1) : "—"} unit="A" />
        <MetricTile label="Power" value={reading ? reading.power.toFixed(0) : "—"} unit="W" />
      </View>

      <Text style={[typography.h2, styles.sectionTitle]}>Load priority</Text>
      <RelayIndicator relays={reading?.relays ?? { r1: false, r2: false, r3: false, r4: false }} />

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
  meterStatusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  meterStatusText: { color: colors.textSecondary, flex: 1 },
  meterStatusSpinner: { marginLeft: spacing.xs },
  pairLink: { marginLeft: spacing.sm },
  pairLinkText: { color: colors.indigo[400] },
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
