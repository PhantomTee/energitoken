import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, Linking, Modal, ActivityIndicator } from "react-native";
import QRCode from "react-native-qrcode-styled";
import { router } from "expo-router";
import { colors } from "../../src/theme/colors";
import { typography, spacing, radius } from "../../src/theme/typography";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { CopyableField } from "../../src/components/CopyableField";
import { useWallet } from "../../src/hooks/useWallet";
import { getDeviceForWallet, unbindDevice } from "../../src/services/deviceBinding";
import { clearFirebaseSession } from "../../src/services/firebaseSession";
import { displayNameFromEmail } from "../../src/services/displayName";

const APP_VERSION = "EnergiToken v1.0 — Polygon Amoy";
const CONTRACT_ADDRESS = "0x8493324De9578BF390092ed6c4a5b1033fBF8048";
const EXPLORER_URL = `https://amoy.polygonscan.com/address/${CONTRACT_ADDRESS}`;
const GITHUB_URL = "https://github.com/PhantomTee/energitoken";

const LANGUAGES = [
  { code: "en", label: "English", available: true },
  { code: "yo", label: "Yorùbá", available: false },
  { code: "ha", label: "Hausa", available: false },
  { code: "ig", label: "Igbo", available: false },
] as const;

function SectionHeader({ children }: { children: string }) {
  return <Text style={[typography.label, styles.sectionHeader]}>{children}</Text>;
}

function SettingsRow({
  label,
  value,
  onPress,
  danger,
}: {
  label: string;
  value?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
}) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper style={styles.row} onPress={onPress}>
      <Text style={[typography.body, styles.rowLabel, danger && styles.rowLabelDanger]}>{label}</Text>
      {value}
    </Wrapper>
  );
}

/**
 * Settings — account, meter pairing, notification preferences, language,
 * about, and share-my-QR. Notification toggles are local-only for now (no
 * backend preference store or push-filtering exists yet); the language
 * selector is functionally English-only, the rest are visibly disabled
 * "coming soon" rather than silently doing nothing.
 */
export default function ProfileScreen() {
  const { email, walletAddress, logout } = useWallet();
  const [deviceId, setDeviceId] = useState<string | null | undefined>(undefined);
  const [unbindVisible, setUnbindVisible] = useState(false);
  const [unbinding, setUnbinding] = useState(false);
  const [unbindError, setUnbindError] = useState<string | null>(null);
  const [qrVisible, setQrVisible] = useState(false);
  const [relayAlerts, setRelayAlerts] = useState(true);
  const [budgetWarnings, setBudgetWarnings] = useState(true);
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]["code"]>("en");
  const displayName = displayNameFromEmail(email);

  const loadDevice = React.useCallback(() => {
    if (!walletAddress) return;
    getDeviceForWallet(walletAddress)
      .then((id) => setDeviceId(id))
      .catch(() => setDeviceId(null));
  }, [walletAddress]);

  useEffect(() => {
    loadDevice();
  }, [loadDevice]);

  const handleLogout = async () => {
    await clearFirebaseSession();
    await logout();
    router.replace("/login");
  };

  const handleUnbind = async () => {
    if (!walletAddress) return;
    setUnbinding(true);
    setUnbindError(null);
    try {
      await unbindDevice(walletAddress);
      setUnbindVisible(false);
      setDeviceId(null);
    } catch (err) {
      setUnbindError(err instanceof Error ? err.message : "Couldn't unbind that meter.");
    } finally {
      setUnbinding(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Text style={[typography.h1, styles.title]}>Settings</Text>
        <AdinkraAccent size={28} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
      </View>

      <View style={styles.identityCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{displayName.charAt(0)}</Text>
        </View>
        <View>
          <Text style={[typography.h2, styles.displayName]}>{displayName}</Text>
          <Text style={[typography.caption, styles.displayEmail]}>{email ?? "Not linked"}</Text>
        </View>
      </View>

      {/* ── Account ── */}
      <SectionHeader>ACCOUNT</SectionHeader>
      <View style={styles.card}>
        <CopyableField label="Email" value={email ?? "Not linked"} mono={false} />
        <View style={{ height: spacing.md }} />
        <CopyableField label="Wallet address" value={walletAddress ?? "—"} />
      </View>
      <Pressable style={styles.logoutButton} onPress={handleLogout}>
        <Text style={[typography.bodyStrong, styles.logoutText]}>Log out</Text>
      </Pressable>

      {/* ── Meter ── */}
      <SectionHeader>METER</SectionHeader>
      <View style={styles.card}>
        <SettingsRow
          label="Device code"
          value={
            <Text style={[typography.dataSm, styles.rowValue]}>
              {deviceId === undefined ? "Loading…" : deviceId ?? "Not paired"}
            </Text>
          }
        />
        {deviceId && (
          <>
            <View style={styles.divider} />
            <SettingsRow
              label="Unbind meter"
              danger
              onPress={() => setUnbindVisible(true)}
              value={<Text style={styles.chevron}>›</Text>}
            />
          </>
        )}
      </View>

      {/* ── Notifications ── */}
      <SectionHeader>NOTIFICATIONS</SectionHeader>
      <View style={styles.card}>
        <SettingsRow
          label="Relay shed alerts"
          value={
            <Switch
              value={relayAlerts}
              onValueChange={setRelayAlerts}
              trackColor={{ true: colors.terracotta[400], false: colors.border }}
            />
          }
        />
        <View style={styles.divider} />
        <SettingsRow
          label="Low budget warnings"
          value={
            <Switch
              value={budgetWarnings}
              onValueChange={setBudgetWarnings}
              trackColor={{ true: colors.terracotta[400], false: colors.border }}
            />
          }
        />
      </View>

      {/* ── Language ── */}
      <SectionHeader>LANGUAGE</SectionHeader>
      <View style={styles.card}>
        {LANGUAGES.map((lang, i) => (
          <React.Fragment key={lang.code}>
            {i > 0 && <View style={styles.divider} />}
            <Pressable
              style={[styles.row, !lang.available && styles.rowDisabled]}
              onPress={() => lang.available && setLanguage(lang.code)}
              disabled={!lang.available}
            >
              <Text style={[typography.body, styles.rowLabel, !lang.available && styles.rowLabelMuted]}>
                {lang.label}
              </Text>
              {!lang.available ? (
                <Text style={[typography.caption, styles.comingSoon]}>Coming soon</Text>
              ) : (
                <Text style={[typography.bodyStrong, language === lang.code ? styles.radioOn : styles.radioOff]}>
                  {language === lang.code ? "●" : "○"}
                </Text>
              )}
            </Pressable>
          </React.Fragment>
        ))}
      </View>

      {/* ── Share QR ── */}
      {walletAddress && (
        <Pressable style={styles.qrButton} onPress={() => setQrVisible(true)}>
          <Text style={[typography.bodyStrong, styles.qrButtonText]}>Share my QR code</Text>
        </Pressable>
      )}

      {/* ── About ── */}
      <SectionHeader>ABOUT</SectionHeader>
      <View style={styles.card}>
        <SettingsRow label="App version" value={<Text style={styles.rowValue}>{APP_VERSION}</Text>} />
        <View style={styles.divider} />
        <SettingsRow
          label="Contract address"
          onPress={() => Linking.openURL(EXPLORER_URL)}
          value={<Text style={styles.chevron}>↗</Text>}
        />
        <View style={styles.divider} />
        <SettingsRow
          label="GitHub"
          onPress={() => Linking.openURL(GITHUB_URL)}
          value={<Text style={styles.chevron}>↗</Text>}
        />
      </View>

      {/* ── Unbind confirmation ── */}
      <Modal visible={unbindVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={[typography.h2, styles.modalTitle]}>Unbind this meter?</Text>
            <Text style={[typography.body, styles.modalBody]}>
              Your app will stop showing live readings until you pair a device again. This does not affect your
              ENGY balance.
            </Text>
            {unbindError && <Text style={[typography.caption, styles.errorText]}>{unbindError}</Text>}
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.secondaryButton, { flex: 1 }]}
                onPress={() => setUnbindVisible(false)}
                disabled={unbinding}
              >
                <Text style={[typography.bodyStrong, styles.secondaryButtonText]}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.dangerButton, { flex: 1 }]} onPress={handleUnbind} disabled={unbinding}>
                {unbinding ? (
                  <ActivityIndicator color={colors.neutral.white} />
                ) : (
                  <Text style={[typography.bodyStrong, styles.buttonText]}>Unbind</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── QR code sheet ── */}
      <Modal visible={qrVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={[typography.h2, styles.modalTitle]}>Your wallet QR code</Text>
            <Text style={[typography.body, styles.modalBody]}>
              Others can scan this to send you energy credit directly.
            </Text>
            {walletAddress && (
              <View style={styles.qrWrap}>
                <QRCode data={walletAddress} pieceSize={8} color={colors.indigo[900]} />
              </View>
            )}
            <Pressable style={styles.button} onPress={() => setQrVisible(false)}>
              <Text style={[typography.bodyStrong, styles.buttonText]}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  title: { color: colors.textPrimary },
  identityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.panelInset,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.terracotta[500],
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: { color: colors.neutral.white, fontSize: 20, fontWeight: "700" },
  displayName: { color: colors.panelInsetText },
  displayEmail: { color: colors.indigo[700], marginTop: 2 },
  sectionHeader: { color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm },
  rowDisabled: { opacity: 0.5 },
  rowLabel: { color: colors.textPrimary },
  rowLabelMuted: { color: colors.textSecondary },
  rowLabelDanger: { color: colors.danger },
  rowValue: { color: colors.textSecondary },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  chevron: { color: colors.textSecondary, fontSize: 16 },
  comingSoon: { color: colors.textSecondary, opacity: 0.6 },
  radioOn: { color: colors.terracotta[400] },
  radioOff: { color: colors.textSecondary },
  logoutButton: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
  },
  logoutText: { color: colors.danger },
  qrButton: {
    backgroundColor: colors.indigo[500],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  qrButtonText: { color: colors.neutral.white },
  errorText: { color: colors.danger, marginTop: spacing.sm },
  modalOverlay: { flex: 1, backgroundColor: "rgba(8,7,15,0.7)", justifyContent: "center", padding: spacing.lg },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  modalTitle: { color: colors.textPrimary, marginBottom: spacing.sm },
  modalBody: { color: colors.textSecondary, marginBottom: spacing.md },
  modalActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  secondaryButton: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: { color: colors.textPrimary },
  dangerButton: { backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  button: {
    backgroundColor: colors.indigo[500],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  buttonText: { color: colors.neutral.white },
  qrWrap: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.lg, backgroundColor: colors.neutral.white, borderRadius: radius.md },
});
