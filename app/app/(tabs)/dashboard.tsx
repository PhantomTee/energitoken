import React, { useState, useCallback, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { router, useFocusEffect, Link } from "expo-router";
import { colors, RelayTier } from "../../src/theme/colors";
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
import { clearFirebaseSession } from "../../src/services/firebaseSession";
import { useNotifications } from "../../src/hooks/useNotifications";
import { usePushNotifications } from "../../src/hooks/usePushNotifications";
import { NotificationsPanel } from "../../src/components/NotificationsPanel";
import { setRelayOverride } from "../../src/services/relayOverride";

/** How stale a reading can be before the status pill drops from Live to No signal. */
const STALE_AFTER_MS = 60_000;

type MeterStatus = "live" | "no-signal" | "fault";

function formatSecondsAgo(updatedAt: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - updatedAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export default function DashboardScreen() {
  const [mode, setMode] = useState<MeterMode>("mock");
  const { walletAddress, email, logout } = useWallet();
  const [topUpVisible, setTopUpVisible] = useState(false);
  const [notifVisible, setNotifVisible] = useState(false);
  const [showMoreReadings, setShowMoreReadings] = useState(false);
  const { notifications, unreadCount, markAllRead } = useNotifications(walletAddress);
  usePushNotifications(walletAddress);
  const [balanceWh, setBalanceWh] = useState<bigint | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [relayBusyTier, setRelayBusyTier] = useState<RelayTier | null>(null);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const {
    reading,
    loading: meterLoading,
    error: meterError,
    deviceId,
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

  // Ticks once a second so "Updated Xs ago" stays accurate -- only while
  // there's a live reading to measure freshness against.
  useEffect(() => {
    if (mode !== "live" || !reading) return;
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [mode, reading]);

  const handleLogout = async () => {
    await clearFirebaseSession();
    await logout();
    router.replace("/login");
  };

  const handleRelayToggle = async (tier: RelayTier, next: boolean | null) => {
    if (!deviceId) return;
    setRelayError(null);
    setRelayBusyTier(tier);
    try {
      await setRelayOverride(deviceId, tier, next);
    } catch (err) {
      setRelayError(err instanceof Error ? err.message : "Couldn't update that load right now.");
    } finally {
      setRelayBusyTier(null);
    }
  };

  const meterStatus: MeterStatus | null =
    mode !== "live" || !hasDevice
      ? null
      : meterError
        ? "fault"
        : reading && nowMs - reading.updatedAt < STALE_AFTER_MS
          ? "live"
          : "no-signal";

  const statusMeta: Record<MeterStatus, { label: string; color: string }> = {
    live: { label: "Live", color: colors.success },
    "no-signal": { label: "No signal from meter", color: colors.warning },
    fault: { label: "Meter fault", color: colors.danger },
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
        <View style={styles.headerRight}>
          {walletAddress && (
            <Pressable onPress={() => setNotifVisible(true)} style={styles.iconButton} hitSlop={8}>
              <Text style={styles.bellIcon}>🔔</Text>
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
                </View>
              )}
            </Pressable>
          )}
          {walletAddress && (
            <Pressable
              onPress={() => router.push("/(tabs)/profile")}
              style={styles.iconButton}
              hitSlop={8}
              accessibilityLabel="Settings"
            >
              <Text style={styles.gearIcon}>⚙</Text>
            </Pressable>
          )}
        </View>
      </View>

      <LiveMockBanner mode={mode} onToggle={setMode} />

      {meterStatus && (
        <View style={[styles.statusPill, { backgroundColor: `${statusMeta[meterStatus].color}22` }]}>
          <View style={[styles.statusDot, { backgroundColor: statusMeta[meterStatus].color }]} />
          <Text style={[typography.caption, { color: statusMeta[meterStatus].color }]}>
            {statusMeta[meterStatus].label}
          </Text>
          {meterStatus !== "fault" && reading && (
            <Text style={[typography.dataXs, styles.statusTimestamp]}>
              Updated {formatSecondsAgo(reading.updatedAt, nowMs)}
            </Text>
          )}
        </View>
      )}

      <View style={styles.balanceCard}>
        <View style={styles.balanceMain}>
          <Text style={[typography.label, styles.balanceLabel]}>Available credit</Text>
          <Text style={[typography.data, styles.balanceValue]}>
            {balanceWh === null ? "···" : tokensToUnits(balanceWh).toLocaleString()}
          </Text>
          <Text style={[typography.dataSm, styles.balanceUnit]}>units · 1 unit = 1 kWh</Text>
        </View>
        <BudgetRing percentUsed={reading?.percentUsed ?? 0} size={96} />
      </View>

      {walletAddress && (
        <View style={styles.quickActionsRow}>
          <Pressable style={[styles.quickActionButton, styles.topUpButton]} onPress={() => setTopUpVisible(true)}>
            <Text style={[typography.bodyStrong, styles.quickActionText]}>Top Up</Text>
          </Pressable>
          <Pressable
            style={[styles.quickActionButton, styles.setBudgetButton]}
            onPress={() => router.push("/(tabs)/budget")}
          >
            <Text style={[typography.bodyStrong, styles.quickActionText]}>Set Budget</Text>
          </Pressable>
        </View>
      )}

      {mode === "live" && !hasDevice && !meterLoading && (
        <View style={styles.meterStatusRow}>
          <Text style={[typography.caption, styles.meterStatusText]}>No device paired yet</Text>
          <Link href="/onboarding" style={styles.pairLink}>
            <Text style={[typography.dataXs, styles.pairLinkText]}>Pair a device →</Text>
          </Link>
        </View>
      )}
      {mode === "live" && meterLoading && (
        <View style={styles.meterStatusRow}>
          <ActivityIndicator color={colors.indigo[400]} />
          <Text style={[typography.caption, styles.meterStatusText]}>Loading live meter data…</Text>
        </View>
      )}
      {mode === "live" && meterError && (
        <Text style={[typography.caption, styles.errorText]}>Couldn't load live data: {meterError}</Text>
      )}

      <View style={styles.tileGrid}>
        <View style={styles.tileRow}>
          <MetricTile label="Voltage" value={reading ? reading.voltage.toFixed(1) : "—"} unit="V" />
          <MetricTile label="Current" value={reading ? reading.current.toFixed(1) : "—"} unit="A" />
        </View>
        <View style={styles.tileRow}>
          <MetricTile label="Power" value={reading ? reading.power.toFixed(0) : "—"} unit="W" />
          <MetricTile
            label="Frequency"
            value={reading?.frequency != null ? reading.frequency.toFixed(1) : "—"}
            unit="Hz"
          />
        </View>
      </View>

      <Pressable onPress={() => setShowMoreReadings((v) => !v)} style={styles.moreToggle}>
        <Text style={[typography.caption, styles.moreToggleText]}>
          {showMoreReadings ? "Show less ▲" : "More readings ▼"}
        </Text>
      </Pressable>
      {showMoreReadings && (
        <View style={styles.tileRow}>
          <MetricTile
            label="Power factor"
            value={reading?.powerFactor != null ? reading.powerFactor.toFixed(2) : "—"}
            unit=""
          />
        </View>
      )}

      <Text style={[typography.h2, styles.sectionTitle]}>Load priority</Text>
      <RelayIndicator
        relays={reading?.relays ?? { r1: false, r2: false, r3: false, r4: false }}
        overrides={reading?.relayOverrides}
        onToggle={deviceId ? handleRelayToggle : undefined}
        disabledTier={relayBusyTier}
      />
      {relayError && <Text style={[typography.caption, styles.errorText]}>{relayError}</Text>}

      {walletAddress && (
        <TopUpModal visible={topUpVisible} onClose={() => setTopUpVisible(false)} walletAddress={walletAddress} />
      )}

      <NotificationsPanel
        visible={notifVisible}
        onClose={() => setNotifVisible(false)}
        notifications={notifications}
        onOpened={markAllRead}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandWordmark: { color: colors.textPrimary, letterSpacing: 0.5 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconButton: { position: "relative", padding: spacing.xs },
  bellIcon: { fontSize: 20 },
  gearIcon: { fontSize: 20, color: colors.textPrimary },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: colors.terracotta[500],
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { color: colors.neutral.white, fontSize: 10, fontWeight: "700" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusTimestamp: { color: colors.textSecondary, marginLeft: spacing.xs },
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
  quickActionsRow: { flexDirection: "row", gap: spacing.sm },
  quickActionButton: {
    flex: 1,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  topUpButton: { backgroundColor: colors.terracotta[500] },
  setBudgetButton: { backgroundColor: colors.indigo[500] },
  quickActionText: { color: colors.neutral.white },
  meterStatusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  meterStatusText: { color: colors.textSecondary, flex: 1 },
  errorText: { color: colors.danger },
  pairLink: { marginLeft: spacing.sm },
  pairLinkText: { color: colors.indigo[400] },
  tileGrid: { gap: spacing.sm },
  tileRow: { flexDirection: "row", gap: spacing.sm },
  moreToggle: { alignSelf: "flex-start" },
  moreToggleText: { color: colors.indigo[400] },
  sectionTitle: { color: colors.textPrimary, marginTop: spacing.sm },
});
