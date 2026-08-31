import React, { useState, useEffect } from "react";
import { Modal, View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Platform, Linking, KeyboardAvoidingView } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { ethers } from "ethers";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { useIsDesktopWeb } from "../hooks/useIsDesktopWeb";
import { apiRequest } from "../services/apiClient";
import { Ionicons } from "@expo/vector-icons";

const BACKEND_URL = Platform.OS === "web" ? "" : process.env.EXPO_PUBLIC_BACKEND_URL ?? "https://energitoken.vercel.app";

// Fallback only, used until /api/tariff responds -- previously this file
// hardcoded its own copy of the tariff permanently (not just as a
// fallback), which could silently drift from the server's real value with
// no way to notice. Now fetched live below; these two constants are only
// ever what's briefly shown before that first response lands.
const FALLBACK_NGN_PER_UNIT = 1000;
const FALLBACK_MIN_TOP_UP_NGN = 100;

type Props = {
  visible: boolean;
  onClose: () => void;
  walletAddress: string;
  getSigner: () => Promise<ethers.Signer>;
  onMinted?: () => void;
};

async function pollOrderStatus(
  reference: string,
  maxAttempts = 12
): Promise<"minted" | "failed" | "mint_failed" | "timeout"> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const res = await fetch(`${BACKEND_URL}/api/payments/status?reference=${reference}`);
      if (!res.ok) continue;
      const json = await res.json();
      if (json.status === "minted") return "minted";
      if (json.status === "failed") return "failed";
      // Payment verified successful, but the on-chain mint itself failed --
      // a terminal state distinct from "still processing".
      if (json.status === "mint_failed") return "mint_failed";
    } catch {
      // network glitch -- keep polling
    }
  }
  return "timeout";
}

export function TopUpModal({ visible, onClose, walletAddress, getSigner, onMinted }: Props) {
  const isDesktop = useIsDesktopWeb();
  const [amountNgn, setAmountNgn] = useState("");
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [tariff, setTariff] = useState({ ngnPerUnit: FALLBACK_NGN_PER_UNIT, minNgn: FALLBACK_MIN_TOP_UP_NGN });

  // Live tariff, fetched fresh each time the modal opens rather than
  // trusting a hardcoded local copy that could silently drift from the
  // server's real rate (see M3 in the security audit this was fixed from).
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/tariff`)
      .then((res) => res.json())
      .then((json: { whPerNgn?: number; minNgn?: number }) => {
        if (cancelled || !json.whPerNgn || !json.minNgn) return;
        setTariff({ ngnPerUnit: 1000 / json.whPerNgn, minNgn: json.minNgn });
      })
      .catch(() => {
        // network glitch -- keep the fallback, don't block the flow on it
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const unitsPreview = amountNgn ? (Number(amountNgn) / tariff.ngnPerUnit).toFixed(3) : "0";

  const handlePay = async () => {
    const amount = Number(amountNgn);
    if (!amount || amount <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    if (amount < tariff.minNgn) {
      setError(`Minimum top-up is ₦${tariff.minNgn.toLocaleString()}.`);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // Authenticated: the server derives walletAddress from this session
      // token rather than trusting it from the request body -- this
      // endpoint used to accept any wallet address from an unauthenticated
      // POST, letting anyone create Flutterwave payment orders on another
      // wallet's behalf.
      const json = await apiRequest<{ reference: string; checkoutUrl: string }>(
        "/api/payments/create",
        walletAddress,
        getSigner,
        { method: "POST", body: { amountNgn: amount } }
      );

      if (Platform.OS === "web") {
        Linking.openURL(json.checkoutUrl);
        onClose();
      } else {
        setLoading(false);
        await WebBrowser.openBrowserAsync(json.checkoutUrl);
        // Browser closed -- start polling to see if mint happened
        setPolling(true);
        const result = await pollOrderStatus(json.reference);
        setPolling(false);
        if (result === "minted") {
          setSuccess(true);
          onMinted?.();
        } else if (result === "failed") {
          setError("Payment was not completed. No charge was made.");
        } else if (result === "mint_failed") {
          setError(
            "Your payment went through, but we hit a hiccup crediting your balance. This is on our side, not yours. It's being retried and should resolve shortly."
          );
        } else {
          // timeout -- payment may still be processing
          setError("Payment is still being confirmed. Check your balance in a few minutes.");
        }
      }
      setAmountNgn("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSuccess(false);
    setError(null);
    setAmountNgn("");
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.header}>
          <Pressable onPress={handleClose} hitSlop={12} style={styles.backButton}>
            <Text style={styles.backArrow}>←</Text>
          </Pressable>
          <Text style={[typography.h2, styles.headerTitle]}>Top Up</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={[styles.body, isDesktop && styles.bodyDesktop]}>
          {success ? (
            <View style={styles.centerBlock}>
              <Text style={[typography.h1, styles.resultTitle]}>Top-up confirmed!</Text>
              <Text style={[typography.body, styles.resultSubtitle]}>
                Your ENGY balance has been updated. It may take a moment to reflect on the dashboard.
              </Text>
              <Pressable style={styles.payButton} onPress={handleClose}>
                <Text style={[typography.bodyStrong, styles.payButtonText]}>Done</Text>
              </Pressable>
            </View>
          ) : polling ? (
            <View style={styles.centerBlock}>
              <ActivityIndicator color={colors.terracotta[400]} style={{ marginBottom: spacing.md }} />
              <Text style={[typography.h1, styles.resultTitle]}>Confirming payment…</Text>
              <Text style={[typography.body, styles.resultSubtitle]}>
                Waiting for your payment to be confirmed. This can take up to a minute.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.amountCard}>
                <Text style={[typography.label, styles.amountCardLabel]}>ENTER AMOUNT</Text>
                <View style={styles.amountRow}>
                  <Text style={styles.currencySymbol}>₦</Text>
                  <TextInput
                    style={styles.amountInput}
                    placeholder="0"
                    placeholderTextColor={colors.neutral[500]}
                    value={amountNgn}
                    onChangeText={setAmountNgn}
                    keyboardType="numeric"
                    editable={!loading}
                  />
                </View>
                {amountNgn.length > 0 && (
                  <View style={styles.conversionPill}>
                    <Ionicons name="swap-horizontal" size={14} color={colors.terracotta[300]} />
                    <Text style={[typography.dataSm, styles.conversionText]}>
                      ≈ {unitsPreview} unit{Number(unitsPreview) !== 1 ? "s" : ""} ENGY
                    </Text>
                  </View>
                )}
              </View>

              <Text style={[typography.caption, styles.minNote]}>
                ₦{tariff.ngnPerUnit.toLocaleString()} = 1 unit (1 kWh) · minimum ₦{tariff.minNgn.toLocaleString()}
              </Text>
              {error && <Text style={[typography.caption, styles.errorText]}>{error}</Text>}

              <Pressable style={[styles.payButton, loading && styles.payButtonDisabled]} onPress={handlePay} disabled={loading}>
                {loading ? (
                  <ActivityIndicator color={colors.indigo[900]} />
                ) : (
                  <View style={styles.payButtonRow}>
                    <Ionicons name="business-outline" size={16} color={colors.indigo[900]} />
                    <Text style={[typography.bodyStrong, styles.payButtonText]}>PAY WITH BANK</Text>
                  </View>
                )}
              </Pressable>

              <Pressable onPress={handleClose} disabled={loading} style={styles.cancelLink}>
                <Text style={[typography.caption, styles.cancelLinkText]}>Cancel</Text>
              </Pressable>

              <View style={styles.poweredByRow}>
                <Ionicons name="shield-checkmark-outline" size={12} color={colors.indigo[300]} />
                <Text style={[typography.dataXs, styles.poweredBy]}>POWERED BY FLUTTERWAVE</Text>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.indigo[900] },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerSpacer: { width: 36, height: 36 },
  backArrow: { color: colors.neutral.white, fontSize: 20 },
  headerTitle: { color: colors.neutral.white },
  body: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.md },
  bodyDesktop: { width: "100%", maxWidth: 440, alignSelf: "center" },
  centerBlock: { alignItems: "center", gap: spacing.md },
  resultTitle: { color: colors.neutral.white, textAlign: "center" },
  resultSubtitle: { color: colors.indigo[100], textAlign: "center", opacity: 0.85 },
  amountCard: {
    backgroundColor: colors.indigo[700],
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.md,
  },
  amountCardLabel: { color: colors.indigo[100], opacity: 0.8 },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    width: "100%",
  },
  currencySymbol: { color: colors.textSecondary, fontSize: 22, marginRight: spacing.sm },
  amountInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 32,
    fontFamily: typography.dataMd.fontFamily,
    paddingVertical: spacing.md,
  },
  conversionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(194,100,58,0.2)",
    borderWidth: 1,
    borderColor: colors.terracotta[400],
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  payButtonRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  poweredByRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  conversionText: { color: colors.terracotta[300] },
  minNote: { color: colors.indigo[100], opacity: 0.7, textAlign: "center" },
  errorText: { color: colors.terracotta[300], textAlign: "center" },
  payButton: {
    backgroundColor: colors.terracotta[300],
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  payButtonDisabled: { opacity: 0.6 },
  payButtonText: { color: colors.indigo[900], letterSpacing: 0.5 },
  cancelLink: { alignItems: "center", padding: spacing.sm },
  cancelLinkText: { color: colors.indigo[100] },
  poweredBy: { color: colors.indigo[300], textAlign: "center", opacity: 0.7, letterSpacing: 0.5 },
});
