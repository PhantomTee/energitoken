import React, { useCallback, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Switch } from "react-native";
import { useFocusEffect, Link } from "expo-router";
import { colors, RelayTier, relayTierLabels } from "../../src/theme/colors";
import { typography, spacing, radius } from "../../src/theme/typography";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { BudgetRing } from "../../src/components/BudgetRing";
import { RelayIndicator } from "../../src/components/RelayIndicator";
import { useWallet } from "../../src/hooks/useWallet";
import { useMeterData } from "../../src/hooks/useMeterData";
import { useTransactionHistory } from "../../src/hooks/useTransactionHistory";
import { getEngyBalance } from "../../src/services/contract";
import { setBudgetWh } from "../../src/services/budget";
import { ensureFirebaseSession } from "../../src/services/firebaseSession";
import { whToUnits, unitsToWh, tokensToUnits } from "../../src/services/units";
import { setRelayOverride } from "../../src/services/relayOverride";
import { useIsDesktopWeb } from "../../src/hooks/useIsDesktopWeb";

const PERIOD_OPTIONS = [7, 14, 30] as const;
type PeriodDays = (typeof PERIOD_OPTIONS)[number];

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Buckets burn (consumption) transactions into calendar days over the trailing
 * `periodDays` window, so it can be compared against the daily budget as a
 * rough over/under trend -- built from the same on-chain burn events the
 * History screen's Consumption tab already reads, not a separate log. */
function useDailyUsage(walletAddress: string | null, periodDays: PeriodDays) {
  const { transactions, loading, error } = useTransactionHistory(walletAddress);

  const days = useMemo(() => {
    const now = Date.now();
    const cutoff = now - periodDays * 24 * 60 * 60 * 1000;
    const byDay = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.direction !== "burn" || tx.timestamp < cutoff) continue;
      const key = dayKey(tx.timestamp);
      byDay.set(key, (byDay.get(key) ?? 0) + tx.amountWh);
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
  }, [transactions, periodDays]);

  return { days, loading, error };
}


/** Sanity ceiling: 100 kWh/day is several times a heavy Nigerian household. */
const MAX_BUDGET_UNITS = 100;

/**
 * The load-shedding ladder — mirrors the ESP32 relay priorities and the
 * oracle's notification thresholds (app/api/oracle/burn.ts).
 */
const SHED_TIERS = [
  { pct: 70, label: "Luxury loads cut", detail: "water heater, AC" },
  { pct: 85, label: "Optional loads cut", detail: "TV, sockets" },
  { pct: 95, label: "Essential loads cut", detail: "fans, some lights" },
] as const;

const RELAY_TABLE_ROWS: { tier: RelayTier; devices: string; threshold: string }[] = [
  { tier: "r1", devices: "Lighting, phone charging", threshold: "Always on" },
  { tier: "r2", devices: "Fans, some lights", threshold: "Sheds at 95% used" },
  { tier: "r3", devices: "TV, sockets", threshold: "Sheds at 85% used" },
  { tier: "r4", devices: "Water heater, AC", threshold: "Sheds at 70% used" },
];

function ShedLadder({ percentUsed }: { percentUsed: number }) {
  return (
    <View style={styles.ladder}>
      {SHED_TIERS.map((tier) => {
        const crossed = percentUsed >= tier.pct;
        return (
          <View key={tier.pct} style={styles.ladderRow}>
            <View style={[styles.ladderDot, crossed ? styles.ladderDotCrossed : styles.ladderDotUpcoming]} />
            <Text style={[typography.dataXs, styles.ladderPct, crossed && styles.ladderTextCrossed]}>
              {tier.pct}%
            </Text>
            <View style={styles.ladderBody}>
              <Text style={[typography.bodyStrong, styles.ladderLabel, crossed && styles.ladderTextCrossed]}>
                {tier.label}
              </Text>
              <Text style={[typography.caption, styles.ladderDetail]}>{tier.detail}</Text>
            </View>
            <Text style={[typography.dataXs, crossed ? styles.ladderStateOff : styles.ladderStateOk]}>
              {crossed ? "ACTIVE" : "—"}
            </Text>
          </View>
        );
      })}
      <View style={styles.ladderRow}>
        <View style={[styles.ladderDot, styles.ladderDotProtected]} />
        <Text style={[typography.dataXs, styles.ladderPct]}>∞</Text>
        <View style={styles.ladderBody}>
          <Text style={[typography.bodyStrong, styles.ladderLabel]}>Critical loads protected</Text>
          <Text style={[typography.caption, styles.ladderDetail]}>lighting, phone charging, never shed</Text>
        </View>
        <Text style={[typography.dataXs, styles.ladderStateOk]}>SAFE</Text>
      </View>
    </View>
  );
}

export default function BudgetScreen() {
  const isDesktop = useIsDesktopWeb();
  const { walletAddress } = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  const [balanceWh, setBalanceWh] = useState<bigint | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [relayBusyTier, setRelayBusyTier] = useState<RelayTier | null>(null);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [periodDays, setPeriodDays] = useState<PeriodDays>(7);

  const { reading, loading, error, deviceId, hasDevice } = useMeterData(walletAddress, "live");
  const { days: dailyUsage } = useDailyUsage(walletAddress, periodDays);
  const [durationInput, setDurationInput] = useState("");

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

  const availableUnits = balanceWh !== null ? tokensToUnits(balanceWh) : null;
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
      await ensureFirebaseSession(walletAddress);
      await setBudgetWh(deviceId, unitsToWh(computedDailyUnits!));
      setDurationInput("");
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save that budget.");
    } finally {
      setSaving(false);
    }
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
          <AdinkraAccent size={28} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
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
                        <Text style={[typography.dataXs, styles.desktopChartLabel]}>
                          {new Date(Date.now() - (6 - dailyUsage.indexOf(day)) * 86400000).toLocaleDateString(undefined, { weekday: "short" })}
                        </Text>
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
                  <Text style={[typography.dataXs, styles.summaryUnit]}> ENGY</Text>
                </Text>
              </View>

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
                    {computedDailyUnits.toFixed(1)} <Text style={typography.dataXs}>ENGY/day</Text>
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

          {/* ── Desktop: Relay Thresholds table ── */}
          <View style={styles.thresholdCard}>
            <Text style={[typography.h2, styles.cardTitle]}>Relay Thresholds (R1–R4)</Text>
            <Text style={[typography.caption, styles.loadGuideIntro]}>
              Configure how your household circuits prioritize energy when approaching budget limits.
              Lower priority relays will be disconnected first.
            </Text>
            <View style={styles.thresholdHeaderRow}>
              <Text style={[typography.label, styles.thCol1]}>RELAY</Text>
              <Text style={[typography.label, styles.thCol2]}>CONNECTED CIRCUITS</Text>
              <Text style={[typography.label, styles.thCol3]}>CUTOFF THRESHOLD</Text>
              <Text style={[typography.label, styles.thCol4]}>STATUS</Text>
            </View>
            {RELAY_TABLE_ROWS.map((row) => {
              const override = reading?.relayOverrides?.[row.tier];
              const isManual = override !== undefined;
              const on = isManual ? override : (reading?.relays?.[row.tier] ?? false);
              const busy = relayBusyTier === row.tier;
              return (
                <View key={row.tier} style={styles.thresholdRow}>
                  <View style={styles.thCol1}>
                    <Text style={[typography.bodyStrong, styles.thRelayName]}>
                      {row.tier.toUpperCase()} {relayTierLabels[row.tier]}
                    </Text>
                  </View>
                  <Text style={[typography.caption, styles.thCol2, styles.thDevices]}>{row.devices}</Text>
                  <Text style={[typography.dataXs, styles.thCol3, styles.thThreshold]}>{row.threshold}</Text>
                  <View style={styles.thCol4}>
                    <Switch
                      value={on}
                      disabled={busy || !deviceId}
                      onValueChange={(next) => {
                        if (deviceId) handleRelayToggle(row.tier, next);
                      }}
                      trackColor={{ true: colors.indigo[500], false: colors.border }}
                    />
                  </View>
                </View>
              );
            })}
          </View>
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
            A cycle is one budget day, as counted by your meter. Usage and shedding reset when the
            meter starts a new cycle.
          </Text>

          {projectionDays !== null && availableUnits !== null && currentBudgetUnits !== null && (
            <View style={styles.projectionCard}>
              <Text style={[typography.bodyStrong, styles.projectionText]}>
                At {currentBudgetUnits.toLocaleString()} units/day, your{" "}
                {availableUnits.toLocaleString()} units last ≈ {projectionDays.toFixed(1)} days.
              </Text>
            </View>
          )}

          {/* ── Load-shedding ladder ── */}
          <Text style={[typography.h2, styles.sectionTitle]}>What happens as you use it</Text>
          <Text style={[typography.caption, styles.ladderIntro]}>
            You're at {Math.round(percentUsed)}% of today's budget.
          </Text>
          <ShedLadder percentUsed={percentUsed} />

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

          {/* ── Live relay state ── */}
          {reading?.relays && (
            <>
              <Text style={[typography.h2, styles.sectionTitle]}>Load Priority Guide</Text>
              <Text style={[typography.caption, styles.loadGuideIntro]}>
                When energy reserves run low, non-essential relays automatically disconnect to
                preserve critical systems based on these thresholds. Tap a load to override it.
              </Text>
              <RelayIndicator
                relays={reading.relays}
                overrides={reading.relayOverrides}
                onToggle={deviceId ? handleRelayToggle : undefined}
                disabledTier={relayBusyTier}
              />
              {relayError && <Text style={[typography.caption, styles.errorText]}>{relayError}</Text>}
            </>
          )}

          {/* ── Set budget ── */}
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

            {durationValid && availableUnits !== null && availableUnits > 0 && (
              <View style={styles.durationInfoBanner}>
                <Text style={[typography.caption, styles.durationInfoText]}>
                  Your <Text style={styles.durationInfoStrong}>{availableUnits.toLocaleString()} units</Text> will
                  last <Text style={styles.durationInfoStrong}>{durationDays} days</Text> at{" "}
                  {computedDailyUnits!.toFixed(1)} units/day.
                </Text>
              </View>
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
          </View>
        </>
      )}
    </ScrollView>
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
  dailyAllowanceBox: {
    backgroundColor: colors.indigo[100],
    borderRadius: radius.md,
    padding: spacing.md,
  },
  dailyAllowanceLabel: { color: colors.indigo[700] },
  dailyAllowanceValue: { color: colors.indigo[900], marginTop: 2 },
  thresholdCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
  },
  thresholdHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  thresholdRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  thCol1: { flex: 1.2 },
  thCol2: { flex: 2 },
  thCol3: { flex: 1.4 },
  thCol4: { flex: 0.8, alignItems: "flex-end" },
  thRelayName: { color: colors.textPrimary },
  thDevices: { color: colors.textSecondary },
  thThreshold: { color: colors.textSecondary },
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
  cycleNote: { color: colors.textSecondary, opacity: 0.8 },
  projectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  projectionText: { color: colors.textPrimary },
  sectionTitle: { color: colors.textPrimary, marginTop: spacing.sm },
  ladderIntro: { color: colors.textSecondary },
  loadGuideIntro: { color: colors.textSecondary, marginTop: -spacing.xs },
  ladder: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  ladderRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ladderDot: { width: 10, height: 10, borderRadius: 5 },
  ladderDotUpcoming: { backgroundColor: colors.neutral[700] },
  ladderDotCrossed: { backgroundColor: colors.terracotta[500] },
  ladderDotProtected: { backgroundColor: colors.success },
  ladderPct: { color: colors.textSecondary, width: 36 },
  ladderBody: { flex: 1 },
  ladderLabel: { color: colors.textPrimary },
  ladderDetail: { color: colors.textSecondary, opacity: 0.7 },
  ladderTextCrossed: { color: colors.terracotta[400] },
  ladderStateOff: { color: colors.terracotta[400], width: 48, textAlign: "right" },
  ladderStateOk: { color: colors.textSecondary, width: 48, textAlign: "right" },
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
});
