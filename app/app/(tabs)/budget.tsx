import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Platform, KeyboardAvoidingView } from "react-native";
import { useFocusEffect, Link } from "expo-router";
import { ethers } from "ethers";
import { colors } from "../../src/theme/colors";
import { typography, spacing, radius } from "../../src/theme/typography";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { BudgetRing } from "../../src/components/BudgetRing";
import { useWallet } from "../../src/hooks/useWallet";
import { useMeterData } from "../../src/hooks/useMeterData";
import { useBurnHistory } from "../../src/hooks/useBurnHistory";
import { getEngyBalance, getSpendableBalance } from "../../src/services/contract";
import { setBudgetWh, resetBudget, setMeterTokenBalance } from "../../src/services/budget";
import { whToUnits, unitsToWh, tokensToUnits } from "../../src/services/units";
import { useIsDesktopWeb } from "../../src/hooks/useIsDesktopWeb";
import { MobileTopBar } from "../../src/components/MobileTopBar";

const PERIOD_OPTIONS = [7, 14, 30] as const;
type PeriodDays = (typeof PERIOD_OPTIONS)[number];

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Buckets the durable burn-history log (see useBurnHistory) into calendar
 * days over the trailing `periodDays` window, so it can be compared against
 * the daily budget as a rough over/under trend. Used to be built from
 * scanning on-chain burn events directly, but that scan only ever sees the
 * last ~100 minutes of blocks (contractEvents.ts's MAX_LOOKBACK_BLOCKS) --
 * nowhere near enough for a multi-day chart given how infrequently the burn
 * oracle actually runs, which is why every bar came up empty. */
function useDailyUsage(
  walletAddress: string | null,
  getSigner: () => Promise<ethers.Signer>,
  periodDays: PeriodDays
) {
  const { entries, loading, error } = useBurnHistory(walletAddress, getSigner);

  const days = useMemo(() => {
    const now = Date.now();
    const cutoff = now - periodDays * 24 * 60 * 60 * 1000;
    const byDay = new Map<string, number>();
    for (const entry of entries) {
      if (entry.timestamp < cutoff) continue;
      const key = dayKey(entry.timestamp);
      byDay.set(key, (byDay.get(key) ?? 0) + entry.deltaWh);
    }

    const result: { key: string; label: string; wh: number }[] = [];
    for (let i = periodDays - 1; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = dayKey(d.getTime());
      result.push({
        key,
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        wh: byDay.get(key) ?? 0,
      });
    }
    return result;
  }, [entries, periodDays]);

  return { days, loading, error };
}


/** Sanity ceiling: 100 kWh/day is several times a heavy Nigerian household. */
const MAX_BUDGET_UNITS = 100;

const CYCLE_LENGTH_MS = 24 * 60 * 60 * 1000;

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/** "Cycle started X ago, resets in ~Y" -- ticks every minute so it reads as
 * live rather than a stale snapshot from whenever the screen last rendered.
 * The "~" is deliberate: the meter can roll early (local-midnight NTP check)
 * or late (25h fallback), so 24h from cycleStartedAt is a close estimate of
 * the next reset, not a promise -- see startNewCycle() in the firmware. */
function useCycleClock(cycleStartedAt: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (cycleStartedAt == null) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [cycleStartedAt]);

  if (cycleStartedAt == null) return null;
  const elapsed = Math.max(0, now - cycleStartedAt);
  const remaining = Math.max(0, CYCLE_LENGTH_MS - elapsed);
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
  const { days: dailyUsage } = useDailyUsage(walletAddress, getSigner, periodDays);
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
  const availableUnits = spendableWh !== null ? tokensToUnits(spendableWh) : null;
  const currentBudgetUnits = reading?.budgetWh != null ? whToUnits(reading.budgetWh) : null;
  const usedUnits = reading?.energyWh != null ? whToUnits(reading.energyWh) : null;

  const percentUsed =
    reading?.percentUsed ??
    (reading?.energyWh != null && reading?.budgetWh ? Math.min(100, (reading.energyWh / reading.budgetWh) * 100) : 0);

  const projectionDays =
    availableUnits !== null && currentBudgetUnits !== null && currentBudgetUnits > 0
      ? availableUnits / currentBudgetUnits
      : null;

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
          {/* ── Desktop: Consumption Curve + Allocate Budget ── */}
          <View style={styles.desktopRow}>
            <View style={styles.consumptionCard}>
              <View style={styles.consumptionCardHeader}>
                <Text style={[typography.h2, styles.cardTitle]}>Consumption Curve</Text>
                <View style={styles.legendRow}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: colors.indigo[500] }]} />
                    <Text style={[typography.caption, styles.legendText]}>Actual</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: colors.terracotta[500] }]} />
                    <Text style={[typography.caption, styles.legendText]}>Over allowance</Text>
                  </View>
                </View>
              </View>
              <Text style={[typography.caption, styles.consumptionCardSubtitle]}>Actual vs Allowance (Last 7 Days)</Text>
              {currentBudgetUnits === null ? (
                <Text style={[typography.caption, styles.statusText]}>Set a budget below to see this chart.</Text>
              ) : (
                <View style={styles.desktopChart}>
                  {dailyUsage.map((day) => {
                    const dayUnits = whToUnits(day.wh);
                    const barPct = Math.min(100, (dayUnits / Math.max(currentBudgetUnits, 1)) * 100);
                    const over = dayUnits > currentBudgetUnits;
                    return (
                      <View key={day.key} style={styles.desktopChartBarWrap}>
                        <View style={styles.desktopChartTrack}>
                          <View
                            style={[
                              styles.desktopChartFill,
                              { height: `${Math.max(2, barPct)}%` },
                              { backgroundColor: over ? colors.terracotta[500] : colors.indigo[500] },
                            ]}
                          />
                        </View>
                        <Text style={[typography.dataXs, styles.desktopChartLabel]}>{day.label}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            <View style={styles.allocateCard}>
              <Text style={[typography.h2, styles.cardTitle]}>Allocate Budget</Text>
              <View style={styles.currentBalanceBox}>
                <Text style={[typography.caption, styles.currentBalanceLabel]}>Current Balance</Text>
                <Text style={[typography.dataMd, styles.currentBalanceValue]}>
                  {availableUnits === null ? "···" : availableUnits.toLocaleString()}
                  <Text style={[typography.dataXs, styles.summaryUnit]}> units</Text>
                </Text>
                <Text style={[typography.dataXs, styles.currentBalanceWh]}>
                  ≈ {spendableWh === null ? "···" : spendableWh.toLocaleString()} ENGY (Wh)
                </Text>
              </View>
              {cycleClock && (
                <Text style={[typography.caption, styles.cycleNote]}>
                  Cycle started {formatDuration(cycleClock.elapsed)} ago · resets in ~
                  {formatDuration(cycleClock.remaining)}
                </Text>
              )}

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
                    {computedDailyUnits.toFixed(1)} <Text style={typography.dataXs}>units/day</Text>
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
          {/* ── Progress: ring + summary ── */}
          <View style={styles.progressCard}>
            <BudgetRing percentUsed={percentUsed} size={120} />
            <View style={styles.progressStats}>
              <View style={styles.statBlock}>
                <Text style={[typography.label, styles.summaryLabel]}>Available</Text>
                <Text style={[typography.dataMd, styles.summaryValue]}>
                  {availableUnits === null ? "···" : availableUnits.toLocaleString()}
                  <Text style={[typography.dataXs, styles.summaryUnit]}> units</Text>
                </Text>
                <Text style={[typography.dataXs, styles.summaryWh]}>
                  ≈ {spendableWh === null ? "···" : spendableWh.toLocaleString()} Wh
                </Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={[typography.label, styles.summaryLabel]}>Budget</Text>
                <Text style={[typography.dataMd, styles.summaryValue]}>
                  {currentBudgetUnits === null ? "—" : currentBudgetUnits.toLocaleString()}
                  <Text style={[typography.dataXs, styles.summaryUnit]}> units/day</Text>
                </Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={[typography.label, styles.summaryLabel]}>Used this cycle</Text>
                <Text style={[typography.dataMd, styles.summaryValue]}>
                  {usedUnits === null ? "—" : usedUnits.toLocaleString()}
                  <Text style={[typography.dataXs, styles.summaryUnit]}> units</Text>
                </Text>
              </View>
            </View>
          </View>

          <Text style={[typography.caption, styles.cycleNote]}>
            {cycleClock
              ? `Cycle started ${formatDuration(cycleClock.elapsed)} ago · resets in ~${formatDuration(cycleClock.remaining)}`
              : "A cycle is one budget day, as counted by your meter. Usage and shedding reset when the meter starts a new cycle."}
          </Text>

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
                  {computedDailyUnits!.toFixed(1)} units/day.
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
                That's {computedDailyUnits.toFixed(1)} units/day -- more than the {MAX_BUDGET_UNITS}/day maximum.
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
          <Text style={[typography.h2, styles.sectionTitle]}>Allowance vs. actual</Text>
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
          {currentBudgetUnits === null ? (
            <Text style={[typography.caption, styles.statusText]}>
              Set a daily budget below to see it plotted against actual usage.
            </Text>
          ) : (
            <>
              <View style={styles.trendChart}>
                {dailyUsage.map((day) => {
                  const dayUnits = whToUnits(day.wh);
                  const barPct = Math.min(100, (dayUnits / currentBudgetUnits) * 100);
                  const over = dayUnits > currentBudgetUnits;
                  return (
                    <View key={day.key} style={styles.trendBarWrap}>
                      <View style={styles.trendBarTrack}>
                        <View
                          style={[
                            styles.trendBarFill,
                            { height: `${barPct}%` },
                            over ? styles.trendBarOver : styles.trendBarUnder,
                          ]}
                        />
                      </View>
                      {periodDays <= 14 && (
                        <Text style={[typography.dataXs, styles.trendBarLabel]}>{day.label.split(" ")[1]}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
              <Text style={[typography.caption, styles.trendSummary]}>
                Over the last {periodDays} days: {whToUnits(dailyUsage.reduce((s, d) => s + d.wh, 0)).toLocaleString()}{" "}
                units used against a {(currentBudgetUnits * periodDays).toLocaleString()}-unit allowance.
              </Text>
            </>
          )}
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
  consumptionCard: {
    flex: 2,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.xs,
  },
  consumptionCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  legendRow: { flexDirection: "row", gap: spacing.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.textSecondary },
  consumptionCardSubtitle: { color: colors.textSecondary, marginBottom: spacing.md },
  desktopChart: { flexDirection: "row", alignItems: "flex-end", height: 180, gap: spacing.sm },
  desktopChartBarWrap: { flex: 1, alignItems: "center", height: "100%", justifyContent: "flex-end", gap: spacing.xs },
  desktopChartTrack: { width: "100%", flex: 1, justifyContent: "flex-end", backgroundColor: colors.background, borderRadius: radius.sm, overflow: "hidden" },
  desktopChartFill: { width: "100%", borderRadius: radius.sm },
  desktopChartLabel: { color: colors.textSecondary },
  allocateCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  currentBalanceBox: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  currentBalanceLabel: { color: colors.textSecondary },
  currentBalanceValue: { color: colors.indigo[900], marginTop: 2 },
  currentBalanceWh: { color: colors.textSecondary, opacity: 0.85, marginTop: 2 },
  dailyAllowanceBox: {
    backgroundColor: colors.indigo[100],
    borderRadius: radius.md,
    padding: spacing.md,
  },
  dailyAllowanceLabel: { color: colors.indigo[700] },
  dailyAllowanceValue: { color: colors.indigo[900], marginTop: 2 },
  resetCardDesktop: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  progressCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  progressStats: { flex: 1, gap: spacing.sm },
  statBlock: {},
  summaryLabel: { color: colors.terracotta[500] },
  summaryValue: { color: colors.textPrimary, marginTop: 2 },
  summaryUnit: { color: colors.textSecondary },
  summaryWh: { color: colors.textSecondary, opacity: 0.85, marginTop: 1 },
  cycleNote: { color: colors.textSecondary, opacity: 0.8 },
  sectionTitle: { color: colors.textPrimary, marginTop: spacing.sm },
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
  trendChart: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 100,
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  trendBarWrap: { flex: 1, alignItems: "center", height: "100%", justifyContent: "flex-end", gap: 4 },
  trendBarTrack: { width: "100%", flex: 1, justifyContent: "flex-end" },
  trendBarFill: { width: "100%", borderRadius: 3, minHeight: 2 },
  trendBarUnder: { backgroundColor: colors.indigo[400] },
  trendBarOver: { backgroundColor: colors.terracotta[500] },
  trendBarLabel: { color: colors.textSecondary, fontSize: 9 },
  trendSummary: { color: colors.textSecondary },
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
