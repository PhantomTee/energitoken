import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Platform, KeyboardAvoidingView } from "react-native";
import { useFocusEffect, Link } from "expo-router";
import { ethers } from "ethers";
import { colors } from "../../src/theme/colors";
import { typography, spacing, radius } from "../../src/theme/typography";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { BudgetSummary } from "../../src/components/BudgetSummary";
import { BalanceRunwayChart } from "../../src/components/BalanceRunwayChart";
import { DailyUsageChart } from "../../src/components/DailyUsageChart";
import { useWallet } from "../../src/hooks/useWallet";
import { useMeterData } from "../../src/hooks/useMeterData";
import { useDailyConsumption, dayKeyLabel } from "../../src/hooks/useDailyConsumption";
import { getEngyBalance, getSpendableBalance } from "../../src/services/contract";
import { setBudgetWh, resetBudget, setMeterTokenBalance } from "../../src/services/budget";
import { whToUnits, unitsToWh, tokensToUnits, toWholeWh } from "../../src/services/units";
import { useIsDesktopWeb } from "../../src/hooks/useIsDesktopWeb";
import { MobileTopBar } from "../../src/components/MobileTopBar";

const PERIOD_OPTIONS = [7, 14, 30] as const;

/** The daily allowance, shown to the watt-hour.
 *
 * A budget is stored and enforced in whole watt-hours (setBudgetWh rounds to
 * one), and 1 unit is exactly 1000 Wh, so three decimal places on a unit
 * figure is not extra precision -- it is the full precision the system holds,
 * with nothing hidden. Rounding to one place, as this used to, displayed a
 * 3.333 units/day allowance as "3.3" while the meter enforced 3333 Wh, so the
 * number the household read and the number their loads were shed against
 * disagreed. Trailing zeros are dropped, so a clean 5 units/day still shows
 * as "5" rather than "5.000". */
function formatUnits(units: number): string {
  return units.toLocaleString(undefined, { maximumFractionDigits: 3 });
}
type PeriodDays = (typeof PERIOD_OPTIONS)[number];

/** Sanity ceiling: 100 kWh/day is several times a heavy Nigerian household. */
const MAX_BUDGET_UNITS = 100;

const WAT_OFFSET_MS = 60 * 60 * 1000; // UTC+1, no DST -- same zone the backend's cycle-tick.ts targets
const DAY_MS = 24 * 60 * 60 * 1000;

/** Real epoch ms of the most recent 00:00 WAT boundary at or before nowMs. */
function lastWatMidnightMs(nowMs: number): number {
  const watNow = new Date(nowMs + WAT_OFFSET_MS);
  return Date.UTC(watNow.getUTCFullYear(), watNow.getUTCMonth(), watNow.getUTCDate()) - WAT_OFFSET_MS;
}

/** The real reset target is always the next WAT calendar-day boundary, not
 * a rolling 24h window from whenever the cycle happened to start -- the
 * firmware's own local-midnight check (checkLocalMidnight() in the .ino)
 * works the same way: it doesn't care how long the current cycle has run,
 * it fires the instant the WAT date changes. A cycle that started at
 * 19:01 resets in ~5h, not ~24h. */
function msUntilNextWatMidnight(nowMs: number): number {
  return Math.max(0, lastWatMidnightMs(nowMs) + DAY_MS - nowMs);
}

/** "Cycle started X ago, resets in ~Y" -- ticks every minute so it reads as
 * live rather than a stale snapshot from whenever the screen last rendered.
 * The "~" is deliberate: the meter can roll a little early or late around
 * the WAT midnight boundary (NTP sync jitter, or the 25h no-signal
 * fallback if a board never got NTP at all), so this is a close estimate
 * of the next reset, not a promise -- see startNewCycle() in the firmware. */
function useCycleClock(cycleStartedAt: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (cycleStartedAt == null) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [cycleStartedAt]);

  if (cycleStartedAt == null) return null;
  // Anchor the shown "started ... ago" to the same 00:00 WAT boundary the
  // reset lands on. In normal operation the meter rolls the cycle at WAT
  // midnight, so cycleStartedAt already is that boundary and this clamp is a
  // no-op. But when the meter's last roll predates the most recent midnight
  // -- a missed midnight it hasn't caught up on, or a board that last rolled
  // in the evening before being powered off/reflashed -- raw elapsed reads as
  // a confusing >24h span straddling a midnight ("started 9h ago · resets in
  // 20h"). Clamping to the last midnight makes the window the calendar day it
  // actually resets on. A cycle genuinely started later today (a budget just
  // set) is after this midnight, so it still shows from then.
  const effectiveStart = Math.max(cycleStartedAt, lastWatMidnightMs(now));
  const elapsed = Math.max(0, now - effectiveStart);
  const remaining = msUntilNextWatMidnight(now);
  return { elapsed, remaining };
}

export default function BudgetScreen() {
  const isDesktop = useIsDesktopWeb();
  const { walletAddress, getSigner } = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  const [balanceWh, setBalanceWh] = useState<bigint | null>(null);
  const [spendableWh, setSpendableWh] = useState<bigint | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [periodDays, setPeriodDays] = useState<PeriodDays>(7);

  const { reading, loading, error, deviceId, hasDevice } = useMeterData(walletAddress, getSigner);
  const { days: dailyUsageRaw } = useDailyConsumption(walletAddress, getSigner, periodDays);
  // The chart wants a display label per bar; the hook returns WAT day keys.
  const dailyUsage = useMemo(
    () => dailyUsageRaw.map((d) => ({ key: d.day, label: dayKeyLabel(d.day), wh: d.wh })),
    [dailyUsageRaw]
  );
  const cycleClock = useCycleClock(reading?.cycleStartedAt);
  const [durationInput, setDurationInput] = useState("");

  // Mirrors the fresh spendable balance into Firebase, same as
  // dashboard.tsx and transfer.tsx's refreshBalance -- without this, a
  // household watching Budget after receiving a transfer or a top-up
  // wouldn't have their meter notice at all until they separately visited
  // Dashboard.
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
      // leave the previous balance on screen rather than clearing it on a transient RPC error
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

  // What's actually available to allocate is the spendable balance, not the
  // raw on-chain one -- otherwise a household could plan a budget against
  // ENGY that's already spoken for by energy they've used but the oracle
  // hasn't burned yet, same distinction Dashboard and Transfer already make.
  /**
   * Consumption settles on-chain only when the oracle runs, so the contract's
   * spendable balance stands still between those writes. The meter's own
   * counter does not: lifetime energy minus the last settled checkpoint is
   * what has been used and not yet paid for, updated every few seconds.
   *
   * The larger of the two unsettled figures is taken, so this can only ever
   * understate what is available -- see the same derivation on the Dashboard.
   * Understating is the safe direction here too: the budget maths and the
   * runway projection both read better as slightly pessimistic than as
   * promising credit the contract would refuse to move.
   */
  const availableWh = useMemo(() => {
    if (balanceWh === null) return null;
    const chainUnsettled =
      spendableWh !== null && balanceWh > spendableWh ? balanceWh - spendableWh : 0n;
    const meterUnsettled =
      reading?.energyTotalWh != null && reading?.lastBurnedWh != null
        ? toWholeWh(reading.energyTotalWh - reading.lastBurnedWh)
        : 0n;
    const unsettled = chainUnsettled > meterUnsettled ? chainUnsettled : meterUnsettled;
    return balanceWh > unsettled ? balanceWh - unsettled : 0n;
  }, [balanceWh, spendableWh, reading?.energyTotalWh, reading?.lastBurnedWh]);

  const availableUnits = availableWh !== null ? tokensToUnits(availableWh) : null;
  const currentBudgetUnits = reading?.budgetWh != null ? whToUnits(reading.budgetWh) : null;
  // What the household actually used today. energyWh is cycle-scoped and
  // restarts the moment a budget is set, so a figure labelled "used today"
  // built on it would silently reset mid-afternoon. energyTodayWh resets only
  // at midnight. Older firmware does not publish it, so fall back rather than
  // showing nothing.
  const usedTodayWh = reading?.energyTodayWh ?? reading?.energyWh ?? null;
  const usedUnits = usedTodayWh != null ? whToUnits(usedTodayWh) : null;

  const percentUsed =
    reading?.percentUsed ??
    (reading?.energyWh != null && reading?.budgetWh ? Math.min(100, (reading.energyWh / reading.budgetWh) * 100) : 0);

  const projectionDays =
    availableUnits !== null && currentBudgetUnits !== null && currentBudgetUnits > 0
      ? availableUnits / currentBudgetUnits
      : null;

  /**
   * Average settled consumption per day over the selected window, used as the
   * "at recent use" rate on the runway chart. The budget rate says how fast
   * the meter will *let* a household spend; this says how fast they actually
   * do, and the two diverge for most people.
   *
   * Excludes today, which is still in progress -- counting a partial day as a
   * full one drags the average down and would overstate the runway, in the
   * direction that leaves somebody surprised when their power cuts. Also
   * excludes days with no settled burns at all, because a zero here doesn't
   * mean "used no electricity": it also covers a meter that was offline, a
   * stretch before this device was paired, and (most often, given how
   * irregularly the burn oracle fires) a day whose consumption simply hasn't
   * been settled on-chain yet. Averaging those in as real zeroes would make
   * every runway look far longer than it is.
   */
  const recentDailyAvgUnits = useMemo(() => {
    const completedDays = dailyUsage.slice(0, -1).filter((d) => d.wh > 0);
    if (completedDays.length === 0) return null;
    const totalWh = completedDays.reduce((sum, d) => sum + d.wh, 0);
    return whToUnits(totalWh / completedDays.length);
  }, [dailyUsage]);

  // ── Duration-based allocation: pick how many days the balance should
  // last, and the daily allowance (the real number the meter enforces) is
  // computed from that -- balance / duration. ─────────────────────────────
  const durationDays = Number(durationInput);
  const durationValid = Number.isFinite(durationDays) && durationDays > 0 && Number.isInteger(durationDays);
  const computedDailyUnits =
    durationValid && availableUnits !== null && availableUnits > 0 ? availableUnits / durationDays : null;
  const computedDailyValid = computedDailyUnits !== null && computedDailyUnits <= MAX_BUDGET_UNITS;

  const handleSetBudget = async () => {
    if (!walletAddress || !deviceId) return;
    if (!durationValid) {
      setSaveError("Enter a whole number of days, greater than 0.");
      return;
    }
    if (availableUnits === null || availableUnits <= 0) {
      setSaveError("You don't have any credit to allocate yet.");
      return;
    }
    if (computedDailyUnits !== null && computedDailyUnits > MAX_BUDGET_UNITS) {
      setSaveError(
        `That works out to more than ${MAX_BUDGET_UNITS} units/day -- spread it over more days.`
      );
      return;
    }

    setSaveError(null);
    setSaveSuccess(false);
    setSaving(true);
    try {
      await setBudgetWh(unitsToWh(computedDailyUnits!), walletAddress, getSigner);
      setDurationInput("");
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save that budget.");
    } finally {
      setSaving(false);
    }
  };

  // Two-tap confirm rather than a native confirm dialog -- RN Web's
  // Alert.alert support is inconsistent, and this is destructive enough
  // (clears the budget, every override, and today's usage) to want a
  // deliberate second tap rather than a single accidental one.
  const handleResetBudget = async () => {
    if (!walletAddress || !deviceId) return;
    if (!resetConfirming) {
      setResetConfirming(true);
      return;
    }
    setResetConfirming(false);
    setResetError(null);
    setSaveSuccess(false);
    setResetting(true);
    try {
      await resetBudget(walletAddress, getSigner);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Couldn't reset the budget.");
    } finally {
      setResetting(false);
    }
  };

  // Auto-revert the confirm state if the second tap never comes, so a
  // forgotten "Tap again to confirm" doesn't sit armed indefinitely.
  useEffect(() => {
    if (!resetConfirming) return;
    const timer = setTimeout(() => setResetConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [resetConfirming]);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}>
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
      {!isDesktop && <MobileTopBar />}

      <View style={styles.titleRow}>
        <Text style={[typography.h1, styles.title]}>{isDesktop ? "Budget Planning" : "Budget"}</Text>
        <View style={styles.titleRight}>
          {isDesktop && (
            <Pressable onPress={handleRefresh} style={styles.refreshButton} disabled={refreshing}>
              {refreshing
                ? <ActivityIndicator size="small" color={colors.indigo[400]} />
                : <Text style={[typography.dataXs, styles.refreshText]}>↻ Refresh</Text>}
            </Pressable>
          )}
          {isDesktop && (
            <AdinkraAccent size={28} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
          )}
        </View>
      </View>
      <Text style={[typography.body, styles.subtitle]}>
        {isDesktop
          ? "Allocate your EnergiTokens efficiently and monitor your consumption against daily allowances."
          : "1 unit = 1 kWh. As usage approaches this budget, your meter sheds loads gently, least important first, instead of everything going dark at once."}
      </Text>

      {loading && (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.indigo[400]} />
          <Text style={[typography.caption, styles.statusText]}>Loading your device…</Text>
        </View>
      )}

      {!loading && error && (
        <Text style={[typography.caption, styles.errorText]}>Couldn't load live data: {error}</Text>
      )}

      {!loading && !error && !hasDevice && (
        <View style={styles.statusRow}>
          <Text style={[typography.caption, styles.statusText]}>
            No device paired yet -- pair one to set a budget.
          </Text>
          <Link href="/onboarding" style={styles.pairLink}>
            <Text style={[typography.dataXs, styles.pairLinkText]}>Pair a device →</Text>
          </Link>
        </View>
      )}

      {!loading && !error && hasDevice && isDesktop && (
        <>
          {/* ── Where the household stands. Shared with the mobile tree
              below, which is the only place it used to exist -- the whole
              reason the web Budget page showed no current budget, no usage
              and no cycle clock. ── */}
          <BudgetSummary
            percentUsed={percentUsed}
            availableUnits={availableUnits}
            spendableWh={availableWh === null ? null : Number(availableWh)}
            currentBudgetUnits={currentBudgetUnits}
            usedUnits={usedUnits}
            cycleClock={cycleClock}
            ringSize={132}
          />

          {/* ── Desktop: credit runway + Allocate Budget ── */}
          <View style={styles.desktopRow}>
            <View style={styles.desktopChartCol}>
              <BalanceRunwayChart
                availableUnits={availableUnits}
                budgetUnitsPerDay={currentBudgetUnits}
                actualUnitsPerDay={recentDailyAvgUnits}
              />
            </View>

            <View style={styles.allocateCard}>
              <Text style={[typography.h2, styles.cardTitle]}>Allocate Budget</Text>
              {/* Balance and cycle clock deliberately not repeated here --
                  BudgetSummary directly above carries both. This card used to
                  be the only place desktop showed them at all, which is why
                  they were bolted onto the allocation form to begin with. */}
              <Text style={[typography.label, styles.fieldLabel]}>DURATION (DAYS)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 30"
                placeholderTextColor={colors.neutral[500]}
                value={durationInput}
                onChangeText={(text) => {
                  setDurationInput(text);
                  setSaveSuccess(false);
                  setSaveError(null);
                }}
                keyboardType="number-pad"
                editable={!saving}
              />

              {durationValid && computedDailyUnits !== null && (
                <View style={styles.dailyAllowanceBox}>
                  <Text style={[typography.caption, styles.dailyAllowanceLabel]}>Daily Allowance</Text>
                  <Text style={[typography.dataMd, styles.dailyAllowanceValue]}>
                    {formatUnits(computedDailyUnits)} <Text style={typography.dataXs}>units/day</Text>
                  </Text>
                  <Text style={[typography.dataXs, styles.dailyAllowanceWh]}>
                    ≈ {unitsToWh(computedDailyUnits).toLocaleString()} Wh/day
                  </Text>
                </View>
              )}
              {durationValid && computedDailyUnits !== null && !computedDailyValid && (
                <Text style={[typography.caption, styles.warnText]}>
                  That's more than the {MAX_BUDGET_UNITS}/day maximum -- try a longer duration.
                </Text>
              )}
              {saveError && <Text style={[typography.caption, styles.errorText]}>{saveError}</Text>}
              {saveSuccess && <Text style={[typography.caption, styles.successText]}>Budget updated.</Text>}

              <Pressable
                style={[styles.button, (!durationValid || !computedDailyValid || saving) && styles.buttonDisabled]}
                onPress={handleSetBudget}
                disabled={!durationValid || !computedDailyValid || saving}
              >
                {saving ? (
                  <ActivityIndicator color={colors.neutral.white} />
                ) : (
                  <Text style={[typography.bodyStrong, styles.buttonText]}>✓ Set Budget</Text>
                )}
              </Pressable>
            </View>
          </View>

          {/* ── Daily use vs allowance, with the same period selector the
              mobile tree has ── */}
          <View style={styles.periodRow}>
            {PERIOD_OPTIONS.map((opt) => (
              <Pressable
                key={opt}
                style={[styles.periodChip, periodDays === opt && styles.periodChipActive]}
                onPress={() => setPeriodDays(opt)}
              >
                <Text style={[typography.caption, periodDays === opt ? styles.periodTextActive : styles.periodText]}>
                  {opt}d
                </Text>
              </Pressable>
            ))}
          </View>
          <DailyUsageChart days={dailyUsage} budgetUnitsPerDay={currentBudgetUnits} />

          {/* ── Desktop: Reset budget ── */}
          {currentBudgetUnits !== null && (
            <View style={styles.resetCardDesktop}>
              <Pressable
                style={[styles.resetButton, resetting && styles.buttonDisabled]}
                onPress={handleResetBudget}
                disabled={resetting}
              >
                {resetting ? (
                  <ActivityIndicator color={colors.danger} />
                ) : (
                  <Text style={[typography.bodyStrong, styles.resetButtonText]}>
                    {resetConfirming ? "Tap again to confirm" : "Reset Budget"}
                  </Text>
                )}
              </Pressable>
              {resetConfirming && (
                <Text style={[typography.caption, styles.warnText]}>
                  Clears your budget entirely, restores every relay to normal, and clears any
                  manual overrides.
                </Text>
              )}
              {resetError && <Text style={[typography.caption, styles.errorText]}>{resetError}</Text>}
            </View>
          )}
        </>
      )}

      {!loading && !error && hasDevice && !isDesktop && (
        <>
          {/* ── Progress: ring + summary (shared with the desktop tree) ── */}
          <BudgetSummary
            percentUsed={percentUsed}
            availableUnits={availableUnits}
            spendableWh={availableWh === null ? null : Number(availableWh)}
            currentBudgetUnits={currentBudgetUnits}
            usedUnits={usedUnits}
            cycleClock={cycleClock}
          />

          <BalanceRunwayChart
            availableUnits={availableUnits}
            budgetUnitsPerDay={currentBudgetUnits}
            actualUnitsPerDay={recentDailyAvgUnits}
          />

          {/* ── Set budget -- the page's actual job, right up front ── */}
          <View style={styles.setBudgetCard}>
            <Text style={[typography.h2, styles.setBudgetTitle]}>Set Budget</Text>
            <Text style={[typography.label, styles.fieldLabel]}>DURATION (DAYS)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 30"
              placeholderTextColor={colors.neutral[500]}
              value={durationInput}
              onChangeText={(text) => {
                setDurationInput(text);
                setSaveSuccess(false);
                setSaveError(null);
              }}
              keyboardType="number-pad"
              editable={!saving}
            />

            {/* One runway line, not two: shows the hypothetical new duration
                while you're typing a valid one, otherwise falls back to the
                currently-set budget's own projection -- these used to be two
                separate cards saying almost the same sentence. */}
            {durationValid && availableUnits !== null && availableUnits > 0 ? (
              <View style={styles.durationInfoBanner}>
                <Text style={[typography.caption, styles.durationInfoText]}>
                  Your <Text style={styles.durationInfoStrong}>{availableUnits.toLocaleString()} units</Text> will
                  last <Text style={styles.durationInfoStrong}>{durationDays} days</Text> at{" "}
                  {formatUnits(computedDailyUnits!)} units/day (≈ {unitsToWh(computedDailyUnits!).toLocaleString()} Wh/day).
                </Text>
              </View>
            ) : (
              projectionDays !== null &&
              availableUnits !== null &&
              currentBudgetUnits !== null && (
                <View style={styles.durationInfoBanner}>
                  <Text style={[typography.caption, styles.durationInfoText]}>
                    At <Text style={styles.durationInfoStrong}>{currentBudgetUnits.toLocaleString()} units/day</Text>,
                    your <Text style={styles.durationInfoStrong}>{availableUnits.toLocaleString()} units</Text> last
                    ≈ {projectionDays.toFixed(1)} days.
                  </Text>
                </View>
              )
            )}
            {durationValid && computedDailyUnits !== null && !computedDailyValid && (
              <Text style={[typography.caption, styles.warnText]}>
                That's {formatUnits(computedDailyUnits)} units/day -- more than the {MAX_BUDGET_UNITS}/day maximum.
                Try a longer duration.
              </Text>
            )}
            {saveError && <Text style={[typography.caption, styles.errorText]}>{saveError}</Text>}
            {saveSuccess && <Text style={[typography.caption, styles.successText]}>Budget updated.</Text>}

            <Pressable
              style={[styles.button, (!durationValid || !computedDailyValid || saving) && styles.buttonDisabled]}
              onPress={handleSetBudget}
              disabled={!durationValid || !computedDailyValid || saving}
            >
              {saving ? (
                <ActivityIndicator color={colors.neutral.white} />
              ) : (
                <Text style={[typography.bodyStrong, styles.buttonText]}>Apply Budget</Text>
              )}
            </Pressable>

            <Text style={[typography.caption, styles.keypadNote]}>
              You can also change the budget from the meter's keypad, handy when there's no
              internet. The app shows whichever value was set most recently.
            </Text>

            {currentBudgetUnits !== null && (
              <>
                <Pressable
                  style={[styles.resetButton, resetting && styles.buttonDisabled]}
                  onPress={handleResetBudget}
                  disabled={resetting}
                >
                  {resetting ? (
                    <ActivityIndicator color={colors.danger} />
                  ) : (
                    <Text style={[typography.bodyStrong, styles.resetButtonText]}>
                      {resetConfirming ? "Tap again to confirm" : "Reset Budget"}
                    </Text>
                  )}
                </Pressable>
                {resetConfirming && (
                  <Text style={[typography.caption, styles.warnText]}>
                    Clears your budget entirely, restores every relay to normal, and clears any
                    manual overrides.
                  </Text>
                )}
                {resetError && <Text style={[typography.caption, styles.errorText]}>{resetError}</Text>}
              </>
            )}
          </View>

          {/* ── Period trend: daily allowance vs actual usage ── */}
          <View style={styles.periodRow}>
            {PERIOD_OPTIONS.map((opt) => (
              <Pressable
                key={opt}
                style={[styles.periodChip, periodDays === opt && styles.periodChipActive]}
                onPress={() => setPeriodDays(opt)}
              >
                <Text style={[typography.caption, periodDays === opt ? styles.periodTextActive : styles.periodText]}>
                  {opt}d
                </Text>
              </Pressable>
            ))}
          </View>
          <DailyUsageChart days={dailyUsage} budgetUnitsPerDay={currentBudgetUnits} />
        </>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md, width: "100%", alignSelf: "center" },
  contentDesktop: { padding: spacing.xxl, paddingBottom: spacing.xxl, maxWidth: 1000 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titleRight: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  title: { color: colors.textPrimary },
  subtitle: { color: colors.textSecondary },
  refreshButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  refreshText: { color: colors.indigo[400] },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusText: { color: colors.textSecondary, flex: 1 },
  errorText: { color: colors.danger },
  successText: { color: colors.success },
  warnText: { color: colors.warning },
  pairLink: { marginLeft: spacing.sm },
  pairLinkText: { color: colors.indigo[400] },
  cardTitle: { color: colors.textPrimary },
  desktopRow: { flexDirection: "row", gap: spacing.xl, alignItems: "stretch" },
  // The runway chart brings its own card chrome, so this column only has to
  // carry the 2:1 width split against the allocation form beside it.
  desktopChartCol: { flex: 2 },
  allocateCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  dailyAllowanceBox: {
    backgroundColor: colors.indigo[100],
    borderRadius: radius.md,
    padding: spacing.md,
  },
  dailyAllowanceLabel: { color: colors.indigo[700] },
  dailyAllowanceValue: { color: colors.indigo[900], marginTop: 2 },
  dailyAllowanceWh: { color: colors.indigo[700], marginTop: 2 },
  resetCardDesktop: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  periodRow: { flexDirection: "row", gap: spacing.sm },
  periodChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  periodChipActive: { backgroundColor: colors.indigo[400], borderColor: colors.indigo[400] },
  periodText: { color: colors.textSecondary },
  periodTextActive: { color: colors.neutral.white },
  fieldLabel: { color: colors.textSecondary },
  setBudgetCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  setBudgetTitle: { color: colors.textPrimary },
  durationInfoBanner: {
    backgroundColor: colors.terracotta[100],
    borderRadius: radius.md,
    padding: spacing.md,
  },
  durationInfoText: { color: colors.terracotta[700] },
  durationInfoStrong: { fontWeight: "700" },
  input: {
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 18,
    fontFamily: typography.dataMd.fontFamily,
    borderWidth: 1,
    borderColor: colors.border,
  },
  button: {
    backgroundColor: colors.terracotta[500],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.neutral.white },
  keypadNote: { color: colors.textSecondary, opacity: 0.8, marginTop: spacing.xs },
  resetButton: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  resetButtonText: { color: colors.danger },
});
