import React, { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useFocusEffect, Link } from "expo-router";
import { colors } from "../../src/theme/colors";
import { typography, spacing, radius } from "../../src/theme/typography";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { useWallet } from "../../src/hooks/useWallet";
import { useMeterData } from "../../src/hooks/useMeterData";
import { getEngyBalance } from "../../src/services/contract";
import { setBudgetWh } from "../../src/services/budget";
import { ensureFirebaseSession } from "../../src/services/firebaseSession";
import { whToUnits, unitsToWh, tokensToUnits } from "../../src/services/units";

/**
 * Budget is always set against live device data -- there's no mock toggle
 * here, since budgeting against fake numbers wouldn't mean anything. Reads
 * the same /meters/{deviceId} node the Dashboard listens to, so the current
 * budget shown here updates live the moment it's written (no separate
 * read-back round trip needed).
 */
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

  const projectionDays =
    availableUnits !== null && currentBudgetUnits !== null && currentBudgetUnits > 0
      ? availableUnits / currentBudgetUnits
      : null;

  const handleSetBudget = async () => {
    const units = Number(budgetInput);
    if (!walletAddress || !deviceId) return;
    if (!Number.isFinite(units) || units <= 0) {
      setSaveError("Enter a budget greater than 0.");
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
        <AdinkraAccent size={28} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
      </View>
      <Text style={[typography.body, styles.subtitle]}>
        1 unit = 1 kWh. Your meter sheds non-critical loads once usage catches up to this budget.
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
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={[typography.label, styles.summaryLabel]}>Available</Text>
              <Text style={[typography.data, styles.summaryValue]}>
                {availableUnits === null ? "···" : availableUnits.toLocaleString()}
              </Text>
              <Text style={[typography.dataSm, styles.summaryUnit]}>units</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryRow}>
              <Text style={[typography.label, styles.summaryLabel]}>Current budget</Text>
              <Text style={[typography.data, styles.summaryValue]}>
                {currentBudgetUnits === null ? "—" : currentBudgetUnits.toLocaleString()}
              </Text>
              <Text style={[typography.dataSm, styles.summaryUnit]}>units/day</Text>
            </View>
          </View>

          {usedUnits !== null && (
            <Text style={[typography.caption, styles.usedText]}>
              {usedUnits.toLocaleString()} units used this cycle
              {reading?.percentUsed != null ? ` (${reading.percentUsed}% of budget)` : ""}.
            </Text>
          )}

          {projectionDays !== null && availableUnits !== null && currentBudgetUnits !== null && (
            <View style={styles.projectionCard}>
              <Text style={[typography.bodyStrong, styles.projectionText]}>
                {availableUnits.toLocaleString()} units available, budget {currentBudgetUnits.toLocaleString()}{" "}
                units/day ≈ {projectionDays.toFixed(1)} days
              </Text>
            </View>
          )}

          <Text style={[typography.h2, styles.sectionTitle]}>Set daily budget</Text>
          <Text style={[typography.label, styles.fieldLabel]}>UNITS PER DAY</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 2"
            placeholderTextColor={colors.neutral[500]}
            value={budgetInput}
            onChangeText={(text) => {
              setBudgetInput(text);
              setSaveSuccess(false);
            }}
            keyboardType="numeric"
            editable={!saving}
          />
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
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: colors.textPrimary },
  subtitle: { color: colors.textSecondary },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusText: { color: colors.textSecondary, flex: 1 },
  errorText: { color: colors.danger },
  successText: { color: colors.success },
  pairLink: { marginLeft: spacing.sm },
  pairLinkText: { color: colors.indigo[400] },
  summaryCard: {
    backgroundColor: colors.panelInset,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
  },
  summaryRow: { flex: 1, alignItems: "flex-start" },
  summaryLabel: { color: colors.terracotta[500] },
  summaryValue: { color: colors.panelInsetText, marginTop: spacing.xs },
  summaryUnit: { color: colors.indigo[700], marginTop: 2 },
  summaryDivider: { width: 1, height: 48, backgroundColor: colors.indigo[300], marginHorizontal: spacing.md },
  usedText: { color: colors.textSecondary },
  projectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  projectionText: { color: colors.textPrimary },
  sectionTitle: { color: colors.textPrimary, marginTop: spacing.sm },
  fieldLabel: { color: colors.textSecondary },
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
});
