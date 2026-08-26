import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Platform } from "react-native";
import { router, useFocusEffect, Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, RelayTier, relayTierLabels } from "../../src/theme/colors";
import { typography, spacing, radius } from "../../src/theme/typography";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { MetricTile } from "../../src/components/MetricTile";
import { BudgetRing } from "../../src/components/BudgetRing";
import { RelayIndicator } from "../../src/components/RelayIndicator";
import { useWallet } from "../../src/hooks/useWallet";
import { TopUpModal } from "../../src/components/TopUpModal";
import { getEngyBalance, getSpendableBalance } from "../../src/services/contract";
import { setMeterTokenBalance } from "../../src/services/budget";
import { useMeterData } from "../../src/hooks/useMeterData";
import { writeDirectoryEntry } from "../../src/services/directory";
import { tokensToUnits, whToUnits } from "../../src/services/units";
import { clearFirebaseSession } from "../../src/services/firebaseSession";
import { useNotifications } from "../../src/hooks/useNotifications";
import { usePushNotifications } from "../../src/hooks/usePushNotifications";
import { NotificationsPanel } from "../../src/components/NotificationsPanel";
import { setRelayOverride } from "../../src/services/relayOverride";
import { Toast } from "../../src/components/Toast";
import { useIsDesktopWeb } from "../../src/hooks/useIsDesktopWeb";

/** How stale a reading can be before the status pill drops from Live to No signal. */
const STALE_AFTER_MS = 30_000;

const SHED_THRESHOLD_PCT: Record<RelayTier, number> = { r1: Infinity, r2: 95, r3: 85, r4: 70 };

type MeterStatus = "live" | "no-signal" | "fault";

function formatSecondsAgo(updatedAt: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - updatedAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export default function DashboardScreen() {
  const isDesktop = useIsDesktopWeb();
  const { walletAddress, email, logout, getSigner } = useWallet();
  const [topUpVisible, setTopUpVisible] = useState(false);
  const [notifVisible, setNotifVisible] = useState(false);
  const [showMoreReadings, setShowMoreReadings] = useState(false);
  const { notifications, unreadCount, markAllRead } = useNotifications(walletAddress, getSigner);
  usePushNotifications(walletAddress, getSigner);
  const [balanceWh, setBalanceWh] = useState<bigint | null>(null);
  const [spendableWh, setSpendableWh] = useState<bigint | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [relayBusyTier, setRelayBusyTier] = useState<RelayTier | null>(null);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const prevRelaysRef = useRef<Record<RelayTier, boolean> | null>(null);
  const {
    reading,
    loading: meterLoading,
    error: meterError,
    deviceId,
    hasDevice,
  } = useMeterData(walletAddress, getSigner);

  const refreshBalance = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const [balance, spendable] = await Promise.all([
        getEngyBalance(walletAddress),
        getSpendableBalance(walletAddress),
      ]);
      setBalanceWh(balance);
      setSpendableWh(spendable);
      if (deviceId) {
        setMeterTokenBalance(Number(spendable), walletAddress, getSigner).catch(() => {
          // best-effort mirror for the meter's local display; a failed write
          // here shouldn't disrupt the balance the app itself just showed
        });
      }
    } catch {
      // leave the previous balances on screen rather than clearing them on a transient RPC error
    }
  }, [walletAddress, deviceId, getSigner]);

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
      writeDirectoryEntry(email, walletAddress, getSigner).catch(() => {
        // non-critical: the user can still be reached by raw wallet address
      });
    }
  }, [walletAddress, email, getSigner]);

  // Ticks once a second so "Updated Xs ago" stays accurate -- only while
  // there's a live reading to measure freshness against.
  useEffect(() => {
    if (!reading) return;
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [reading]);

  // Toast the moment a relay tier flips ON -> OFF (a real shed event, not
  // just the initial reading arriving). Skips the very first reading so we
  // don't toast for whatever state the meter happened to already be in.
  useEffect(() => {
    if (!reading?.relays) return;
    const prev = prevRelaysRef.current;
    prevRelaysRef.current = reading.relays;
    if (!prev) return;

    (Object.keys(reading.relays) as RelayTier[]).forEach((tier) => {
      if (prev[tier] && !reading.relays[tier]) {
        const pct = SHED_THRESHOLD_PCT[tier];
        setToastMessage(
          `${relayTierLabels[tier]} circuit disconnected${Number.isFinite(pct) ? `, ${pct}% budget reached` : ""}`
        );
      }
    });
  }, [reading?.relays]);

  const handleLogout = async () => {
    await clearFirebaseSession();
    await logout();
    router.replace("/login");
  };

  const handleRelayToggle = async (tier: RelayTier, next: boolean | null) => {
    if (!deviceId || !walletAddress) return;
    setRelayError(null);
    setRelayBusyTier(tier);
    try {
      await setRelayOverride(tier, next, walletAddress, getSigner);
    } catch (err) {
      setRelayError(err instanceof Error ? err.message : "Couldn't update that load right now.");
    } finally {
      setRelayBusyTier(null);
    }
  };

  const meterStatus: MeterStatus | null =
    !hasDevice
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
      contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={colors.indigo[400]}
          colors={[colors.indigo[400]]}
        />
      }
    >
      <Toast message={toastMessage} onHide={() => setToastMessage(null)} />

      <View style={styles.header}>
        <View style={styles.brandRow}>
          <AdinkraAccent size={32} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
          <Text style={[typography.h2, styles.brandWordmark]}>ENERGITOKEN</Text>
        </View>
        <View style={styles.headerRight}>
          {walletAddress && (
            <Pressable onPress={() => setNotifVisible(true)} style={styles.iconButton} hitSlop={8}>
              <Ionicons name="notifications-outline" size={20} color={colors.textPrimary} />
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
              <Ionicons name="settings-outline" size={20} color={colors.textPrimary} />
            </Pressable>
          )}
        </View>
      </View>

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

      {isDesktop ? (
        <>
          {/* ── Desktop: 4-metric row ── */}
          <View style={styles.metricRow}>
            <MetricTile label="Voltage" value={reading ? reading.voltage.toFixed(1) : "—"} unit="V" />
            <MetricTile label="Current" value={reading ? reading.current.toFixed(1) : "—"} unit="A" />
            <MetricTile label="Power" value={reading ? reading.power.toFixed(0) : "—"} unit="W" />
            <MetricTile
              label="Energy"
              value={reading?.energyWh != null ? whToUnits(reading.energyWh).toFixed(1) : "—"}
              unit="kWh"
            />
          </View>

          {!hasDevice && !meterLoading && (
            <View style={styles.meterStatusRow}>
              <Text style={[typography.caption, styles.meterStatusText]}>No device paired yet</Text>
              <Link href="/onboarding" style={styles.pairLink}>
                <Text style={[typography.dataXs, styles.pairLinkText]}>Pair a device →</Text>
              </Link>
            </View>
          )}
          {hasDevice && meterLoading && (
            <View style={styles.meterStatusRow}>
              <ActivityIndicator color={colors.indigo[400]} />
              <Text style={[typography.caption, styles.meterStatusText]}>Loading live meter data…</Text>
            </View>
          )}
          {meterError && (
            <Text style={[typography.caption, styles.errorText]}>Couldn't load live data: {meterError}</Text>
          )}

          {/* ── Desktop: Daily Budget ring + Wallet ── */}
          <View style={styles.desktopRow}>
            <View style={styles.dailyBudgetCard}>
              <Text style={[typography.h2, styles.cardTitle]}>Daily Budget</Text>
              <BudgetRing percentUsed={reading?.percentUsed ?? 0} size={140} />
              <Text style={[typography.dataSm, styles.dailyBudgetSummary]}>
                {reading?.energyWh != null ? reading.energyWh.toLocaleString() : "—"} Wh consumed of{" "}
                {reading?.budgetWh != null ? reading.budgetWh.toLocaleString() : "—"} Wh
              </Text>
            </View>

            <View style={styles.walletCard}>
              <View style={styles.walletCardHeader}>
                <Text style={[typography.h2, styles.cardTitle]}>Wallet</Text>
                <Ionicons name="wallet-outline" size={18} color={colors.textSecondary} />
              </View>
              <Text style={[typography.label, styles.walletLabel]}>Available Balance</Text>
              <Text style={[typography.dataMd, styles.walletValue]}>
                {spendableWh === null ? "···" : tokensToUnits(spendableWh).toLocaleString()}
                <Text style={[typography.dataXs, styles.walletUnit]}> ENGY</Text>
              </Text>
              {balanceWh !== null && spendableWh !== null && balanceWh !== spendableWh && (
                <Text style={[typography.caption, styles.walletSpendableHint]}>
                  {tokensToUnits(balanceWh).toLocaleString()} ENGY on-chain — the rest is energy
                  already used but not yet settled.
                </Text>
              )}
              {walletAddress && (
                <Pressable style={styles.walletTopUpButton} onPress={() => setTopUpVisible(true)}>
                  <Text style={[typography.bodyStrong, styles.quickActionText]}>+ Top Up Balance</Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* ── Desktop: Relay Control Status ── */}
          <View style={styles.relayCard}>
            <Text style={[typography.h2, styles.cardTitle]}>Relay Control Status</Text>
            <RelayIndicator
              variant="compact"
              relays={reading?.relays ?? { r1: false, r2: false, r3: false, r4: false }}
              overrides={reading?.relayOverrides}
              onToggle={deviceId ? handleRelayToggle : undefined}
              disabledTier={relayBusyTier}
            />
            {relayError && <Text style={[typography.caption, styles.errorText]}>{relayError}</Text>}
          </View>
        </>
      ) : (
        <>
          {/* ── ENGY Balance -- first thing on the screen ── */}
          <View style={styles.balanceCard}>
            <Text style={[typography.bodyStrong, styles.balanceCardTitle]}>ENGY Balance</Text>
            <Text style={[typography.data, styles.balanceValue]}>
              {balanceWh === null ? "···" : tokensToUnits(balanceWh).toLocaleString()}
              <Text style={[typography.dataSm, styles.balanceValueUnit]}> ENGY</Text>
            </Text>
            <Text style={[typography.dataSm, styles.balanceUnit]}>
              ≈ {balanceWh === null ? "···" : balanceWh.toLocaleString()} Wh credit
            </Text>
            {balanceWh !== null && spendableWh !== null && balanceWh !== spendableWh && (
              <Text style={[typography.caption, styles.balanceSpendableHint]}>
                {tokensToUnits(spendableWh).toLocaleString()} ENGY spendable — the rest is energy
                already used but not yet settled on-chain.
              </Text>
            )}
            {walletAddress && (
              <Pressable style={styles.topUpButton} onPress={() => setTopUpVisible(true)}>
                <Text style={[typography.bodyStrong, styles.quickActionText]}>Top Up</Text>
              </Pressable>
            )}
          </View>

          {!hasDevice && !meterLoading && (
            <View style={styles.meterStatusRow}>
              <Text style={[typography.caption, styles.meterStatusText]}>No device paired yet</Text>
              <Link href="/onboarding" style={styles.pairLink}>
                <Text style={[typography.dataXs, styles.pairLinkText]}>Pair a device →</Text>
              </Link>
            </View>
          )}
          {hasDevice && meterLoading && (
            <View style={styles.meterStatusRow}>
              <ActivityIndicator color={colors.indigo[400]} />
              <Text style={[typography.caption, styles.meterStatusText]}>Loading live meter data…</Text>
            </View>
          )}
          {meterError && (
            <Text style={[typography.caption, styles.errorText]}>Couldn't load live data: {meterError}</Text>
          )}

          {/* ── Live Readings ── */}
          <View style={styles.readingsCard}>
            <View style={styles.readingsCardHeader}>
              <Text style={[typography.bodyStrong, styles.readingsCardTitle]}>Live Readings</Text>
              {meterStatus === "live" && (
                <View style={styles.liveBadgeRow}>
                  <View style={styles.liveDot} />
                  <Text style={[typography.dataXs, styles.liveBadgeText]}>LIVE</Text>
                </View>
              )}
            </View>
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
          </View>

          {/* ── Relay Status ── */}
          <View style={styles.relayCard}>
            <Text style={[typography.bodyStrong, styles.relayCardTitle]}>Relay Status</Text>
            <RelayIndicator
              variant="compact"
              relays={reading?.relays ?? { r1: false, r2: false, r3: false, r4: false }}
              overrides={reading?.relayOverrides}
              onToggle={deviceId ? handleRelayToggle : undefined}
              disabledTier={relayBusyTier}
            />
            {relayError && <Text style={[typography.caption, styles.errorText]}>{relayError}</Text>}
          </View>

          {/* ── Budget Status ── */}
          <View style={styles.budgetStatusCard}>
            <View style={styles.budgetStatusHeader}>
              <Text style={[typography.bodyStrong, styles.readingsCardTitle]}>Budget Status</Text>
              <Pressable onPress={() => router.push("/(tabs)/budget")}>
                <Text style={[typography.dataXs, styles.pairLinkText]}>Set Budget →</Text>
              </Pressable>
            </View>
            <BudgetRing percentUsed={reading?.percentUsed ?? 0} size={120} />
            <Text style={[typography.dataSm, styles.dailyBudgetSummary]}>
              {reading?.energyWh != null ? reading.energyWh.toLocaleString() : "—"} Wh used of{" "}
              {reading?.budgetWh != null ? reading.budgetWh.toLocaleString() : "—"} Wh
            </Text>
          </View>
        </>
      )}

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
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, width: "100%", alignSelf: "center" },
  contentDesktop: { padding: spacing.xxl, paddingBottom: spacing.xxl, maxWidth: 1000 },
  pageHeading: { marginBottom: spacing.xs },
  pageTitle: { color: colors.indigo[900] },
  pageSubtitle: { color: colors.textSecondary, marginTop: spacing.xs },
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
    gap: spacing.xs,
  },
  balanceCardTitle: { color: colors.panelInsetText },
  balanceValue: { color: colors.panelInsetText, marginTop: spacing.xs },
  balanceValueUnit: { color: colors.indigo[100] },
  balanceUnit: { color: colors.indigo[100], opacity: 0.85, marginBottom: spacing.md },
  balanceSpendableHint: { color: colors.indigo[100], opacity: 0.7, marginTop: -spacing.sm, marginBottom: spacing.md },
  topUpButton: {
    backgroundColor: colors.terracotta[500],
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  quickActionText: { color: colors.neutral.white },
  budgetStatusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  budgetStatusHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    marginBottom: spacing.xs,
  },
  meterStatusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  meterStatusText: { color: colors.textSecondary, flex: 1 },
  errorText: { color: colors.danger },
  pairLink: { marginLeft: spacing.sm },
  pairLinkText: { color: colors.indigo[400] },
  relayCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  relayCardTitle: { color: colors.textPrimary },
  cardTitle: { color: colors.textPrimary, marginBottom: spacing.md },
  metricRow: { flexDirection: "row", gap: spacing.md },
  desktopRow: { flexDirection: "row", gap: spacing.xl, alignItems: "stretch" },
  dailyBudgetCard: {
    flex: 2,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: "center",
  },
  dailyBudgetSummary: { color: colors.textPrimary, marginTop: spacing.lg },
  walletCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    justifyContent: "space-between",
  },
  walletCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  walletIcon: { fontSize: 18 },
  walletLabel: { color: colors.textSecondary, marginTop: spacing.md },
  walletValue: { color: colors.indigo[900], marginTop: spacing.xs },
  walletUnit: { color: colors.textSecondary },
  walletSpendableHint: { color: colors.textSecondary, marginTop: spacing.xs },
  walletTopUpButton: {
    backgroundColor: colors.terracotta[500],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.xl,
  },
  readingsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  readingsCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  readingsCardTitle: { color: colors.textPrimary },
  liveBadgeRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  liveBadgeText: { color: colors.success, letterSpacing: 0.5 },
  tileGrid: { gap: spacing.sm },
  tileRow: { flexDirection: "row", gap: spacing.sm },
  moreToggle: { alignSelf: "flex-start" },
  moreToggleText: { color: colors.indigo[400] },
  sectionTitle: { color: colors.textPrimary, marginTop: spacing.sm },
});
