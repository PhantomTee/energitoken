import React, { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Platform } from "react-native";
import { useFocusEffect, Link } from "expo-router";
import { colors } from "../../src/theme/colors";
import { typography, spacing, radius } from "../../src/theme/typography";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { BudgetRing } from "../../src/components/BudgetRing";
import { RelayIndicator } from "../../src/components/RelayIndicator";
import { useWallet } from "../../src/hooks/useWallet";
import { useMeterData } from "../../src/hooks/useMeterData";
import { getEngyBalance } from "../../src/services/contract";
import { setBudgetWh } from "../../src/services/budget";
import { ensureFirebaseSession } from "../../src/services/firebaseSession";
import { whToUnits, unitsToWh, tokensToUnits } from "../../src/services/units";

const isWeb = Platform.OS === "web";

/** Sanity ceiling: 100 kWh/day is several times a heavy Nigerian household. */
const MAX_BUDGET_UNITS = 100;

const PRESET_UNITS = [1, 2, 5];

/**
 * The load-shedding ladder — mirrors the ESP32 relay priorities and the
 * oracle's notification thresholds (app/api/oracle/burn.ts).
 */
const SHED_TIERS = [
  { pct: 70, label: "Luxury loads cut", detail: "water heater, AC" },
  { pct: 85, label: "Optional loads cut", detail: "TV, sockets" },
  { pct: 95, label: "Essential loads cut", detail: "fans, some lights" },
] as const;

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
          <Text style={[typography.caption, styles.ladderDetail]}>lighting, phone charging — never shed</Text>
        </View>
        <Text style={[typography.dataXs, styles.ladderStateOk]}>SAFE</Text>
      </View>
    </View>
  );
}

export default function BudgetScreen() {
  const { walletAddress } = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  const [balanceWh, setBalanceWh] = useState<bigint | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const { reading, loading, error, deviceId, hasDevice } = useMeterData(walletAddress, "live");

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

  // ── Live input preview ─────────────────────────────────────────────────
  const inputUnits = Number(budgetInput);
  const inputValid = Number.isFinite(inputUnits) && inputUnits > 0 && inputUnits <= MAX_BUDGET_UNITS;
  const inputWh = inputValid ? unitsToWh(inputUnits) : null;
  const inputProjectionDays =
    inputValid && availableUnits !== null && inputUnits > 0 ? availableUnits / inputUnits : null;
  const overBalance = inputValid && availableUnits !== null && inputUnits > availableUnits;

  const handleSetBudget = async () => {
    const units = Number(budgetInput);
    if (!walletAddress || !deviceId) return;
    if (!Number.isFinite(units) || units <= 0) {
      setSaveError("Enter a budget greater than 0.");
      return;
    }
    if (units > MAX_BUDGET_UNITS) {
      setSaveError(`That's unrealistically high — the maximum is ${MAX_BUDGET_UNITS} units/day.`);
      return;
    }

    setSaveError(null);
    setSaveSuccess(false);
    setSaving(true);
    try {
      await ensureFirebaseSession(walletAddress);
      await setBudgetWh(deviceId, unitsToWh(units));
      setBudgetInput("");
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
      <View style={styles.titleRow}>
        <Text style={[typography.h1, styles.title]}>Budget</Text>
        <View style={styles.titleRight}>
          {isWeb && (
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
        1 unit = 1 kWh. As usage approaches this budget, your meter sheds loads gently, least
        important first — instead of everything going dark at once.
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

      {!loading && !error && hasDevice && (
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

          {/* ── Live relay state ── */}
          {reading?.relays && (
            <>
              <Text style={[typography.h2, styles.sectionTitle]}>Loads right now</Text>
              <RelayIndicator relays={reading.relays} />
            </>
          )}

          {/* ── Set budget ── */}
          <Text style={[typography.h2, styles.sectionTitle]}>Set daily budget</Text>
          <Text style={[typography.label, styles.fieldLabel]}>UNITS PER DAY</Text>
          <View style={styles.presetRow}>
            {PRESET_UNITS.map((preset) => (
              <Pressable
                key={preset}
                style={[styles.presetChip, budgetInput === String(preset) && styles.presetChipActive]}
                onPress={() => {
                  setBudgetInput(String(preset));
                  setSaveSuccess(false);
                  setSaveError(null);
                }}
                disabled={saving}
              >
                <Text
                  style={[
                    typography.bodyStrong,
                    budgetInput === String(preset) ? styles.presetTextActive : styles.presetText,
                  ]}
                >
                  {preset} unit{preset === 1 ? "" : "s"}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="e.g. 2"
            placeholderTextColor={colors.neutral[500]}
            value={budgetInput}
            onChangeText={(text) => {
              setBudgetInput(text);
              setSaveSuccess(false);
              setSaveError(null);
            }}
            keyboardType="numeric"
            editable={!saving}
          />

          {inputValid && (
            <Text style={[typography.caption, styles.previewText]}>
              = {inputWh?.toLocaleString()} Wh/day
              {inputProjectionDays !== null &&
                ` · your credit would last ≈ ${inputProjectionDays.toFixed(1)} days`}
            </Text>
          )}
          {overBalance && (
            <Text style={[typography.caption, styles.warnText]}>
              Heads up: that's more than your available credit ({availableUnits?.toLocaleString()}{" "}
              units) — you'd run out before the day ends.
            </Text>
          )}
          {saveError && <Text style={[typography.caption, styles.errorText]}>{saveError}</Text>}
          {saveSuccess && <Text style={[typography.caption, styles.successText]}>Budget updated.</Text>}

          <Pressable
            style={[styles.button, (!budgetInput || saving) && styles.buttonDisabled]}
            onPress={handleSetBudget}
            disabled={!budgetInput || saving}
          >
            {saving ? (
              <ActivityIndicator color={colors.neutral.white} />
            ) : (
              <Text style={[typography.bodyStrong, styles.buttonText]}>Save budget</Text>
            )}
          </Pressable>

          <Text style={[typography.caption, styles.keypadNote]}>
            You can also change the budget from the meter's keypad — handy when there's no
            internet. The app shows whichever value was set most recently.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
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
  progressCard: {
    backgroundColor: colors.panelInset,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  progressStats: { flex: 1, gap: spacing.sm },
  statBlock: {},
  summaryLabel: { color: colors.terracotta[500] },
  summaryValue: { color: colors.panelInsetText, marginTop: 2 },
  summaryUnit: { color: colors.indigo[700] },
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
  fieldLabel: { color: colors.textSecondary },
  presetRow: { flexDirection: "row", gap: spacing.sm },
  presetChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  presetChipActive: { backgroundColor: colors.indigo[400], borderColor: colors.indigo[400] },
  presetText: { color: colors.textPrimary },
  presetTextActive: { color: colors.neutral.white },
  previewText: { color: colors.indigo[400] },
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
