import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, Linking, Modal, ActivityIndicator, Platform } from "react-native";
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
import { useTransactionHistory } from "../../src/hooks/useTransactionHistory";
import { exportTransactionsCsv } from "../../src/services/exportReport";
import { useIsDesktopWeb } from "../../src/hooks/useIsDesktopWeb";
import { Ionicons } from "@expo/vector-icons";

const APP_VERSION = "EnergiToken v1.0 · Polygon Amoy";
const CONTRACT_ADDRESS = "0x8493324De9578BF390092ed6c4a5b1033fBF8048";
const EXPLORER_URL = `https://amoy.polygonscan.com/address/${CONTRACT_ADDRESS}`;
const GITHUB_URL = "https://github.com/PhantomTee/energitoken";

const LANGUAGES = [{ code: "en", label: "English", available: true }] as const;

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
  const isDesktop = useIsDesktopWeb();
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
  const { transactions: exportTransactions } = useTransactionHistory(isDesktop ? walletAddress : null);

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
    <ScrollView
      style={[styles.screen, !isDesktop && styles.screenMobileTint]}
      contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
    >
      <View style={styles.titleRow}>
        <Text style={[typography.h1, styles.title]}>Settings</Text>
        <AdinkraAccent size={28} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
      </View>

      {isDesktop ? (
        <>
          <Text style={[typography.body, styles.desktopSubtitle]}>
            Manage your account preferences and device connections.
          </Text>

          <View style={styles.desktopGridRow}>
            {/* ── Account Details ── */}
            <View style={styles.desktopCard}>
              <Text style={[typography.h2, styles.desktopCardTitle]}>Account Details</Text>
              <CopyableField label="Email address" value={email ?? "Not linked"} mono={false} />
              <View style={{ height: spacing.md }} />
              <CopyableField label="Wallet address" value={walletAddress ?? "—"} />
              <View style={styles.divider} />
              <SettingsRow
                label="Active Session"
                onPress={handleLogout}
                value={
                  <Pressable style={styles.logoutChip} onPress={handleLogout}>
                    <Text style={styles.logoutChipText}>Log out</Text>
                  </Pressable>
                }
              />
            </View>

            {/* ── Linked Meter ── */}
            <View style={styles.desktopCard}>
              <Text style={[typography.h2, styles.desktopCardTitle]}>Linked Meter</Text>
              <View style={styles.meterBox}>
                <Text style={[typography.caption, styles.meterBoxLabel]}>Device ID</Text>
                <Text style={[typography.dataMd, styles.meterBoxValue]}>
                  {deviceId === undefined ? "Loading…" : deviceId ?? "Not paired"}
                </Text>
                {deviceId && (
                  <View style={styles.meterStatusRow}>
                    <View style={styles.liveDot} />
                    <Text style={[typography.caption, styles.meterStatusText]}>Status: Online & Syncing</Text>
                  </View>
                )}
              </View>
              {deviceId && (
                <Pressable style={styles.unbindButtonRow} onPress={() => setUnbindVisible(true)}>
                  <Ionicons name="close-circle-outline" size={16} color={colors.danger} />
                  <Text style={[typography.bodyStrong, styles.unbindButtonText]}>Unbind Device</Text>
                </Pressable>
              )}
            </View>
          </View>

          <View style={styles.desktopGridRow}>
            {/* ── Alerts & Warnings ── */}
            <View style={styles.desktopCard}>
              <View style={styles.desktopCardTitleRow}>
                <Ionicons name="notifications-outline" size={18} color={colors.textPrimary} />
                <Text style={[typography.h2, styles.desktopCardTitle]}>Alerts &amp; Warnings</Text>
              </View>
              <SettingsRow
                label="Relay shed alerts"
                value={
                  <Switch
                    value={relayAlerts}
                    onValueChange={setRelayAlerts}
                    trackColor={{ true: colors.indigo[500], false: colors.border }}
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
                    trackColor={{ true: colors.indigo[500], false: colors.border }}
                  />
                }
              />
            </View>

            {/* ── Localization ── */}
            <View style={styles.desktopCard}>
              <View style={styles.desktopCardTitleRow}>
                <Ionicons name="globe-outline" size={18} color={colors.textPrimary} />
                <Text style={[typography.h2, styles.desktopCardTitle]}>Localization</Text>
              </View>
              <Text style={[typography.label, styles.fieldLabel]}>DISPLAY LANGUAGE</Text>
              <View style={styles.languageBox}>
                <Text style={[typography.body, styles.rowLabel]}>English (US)</Text>
              </View>
              <Text style={[typography.label, styles.fieldLabel]}>DATA EXPORT</Text>
              <Text style={[typography.caption, styles.exportHint]}>
                Download a copy of your historical consumption data.
              </Text>
              <Pressable
                style={styles.csvExportButton}
                disabled={exportTransactions.length === 0 || !walletAddress}
                onPress={() => walletAddress && exportTransactionsCsv(exportTransactions, walletAddress)}
              >
                <Ionicons name="download-outline" size={16} color={colors.indigo[500]} />
                <Text style={[typography.bodyStrong, styles.csvExportButtonText]}>Request CSV Export</Text>
              </Pressable>
            </View>
          </View>

          {walletAddress && (
            <Pressable style={styles.qrButton} onPress={() => setQrVisible(true)}>
              <Text style={[typography.bodyStrong, styles.qrButtonText]}>Share my QR code</Text>
            </Pressable>
          )}

          <View style={styles.desktopFooter}>
            <Text style={[typography.caption, styles.rowValue]}>{APP_VERSION}</Text>
            <Pressable onPress={() => Linking.openURL(EXPLORER_URL)}>
              <Text style={[typography.dataXs, styles.footerLink]}>Contract ↗</Text>
            </Pressable>
            <Pressable onPress={() => Linking.openURL(GITHUB_URL)}>
              <Text style={[typography.dataXs, styles.footerLink]}>GitHub ↗</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
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
            <View style={styles.divider} />
            <SettingsRow
              label="Active session"
              onPress={handleLogout}
              value={
                <Pressable style={styles.logoutChip} onPress={handleLogout}>
                  <Text style={styles.logoutChipText}>Log out</Text>
                </Pressable>
              }
            />
          </View>

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
            {LANGUAGES.map((lang) => (
              <Pressable key={lang.code} style={styles.row} onPress={() => setLanguage(lang.code)}>
                <Text style={[typography.body, styles.rowLabel]}>{lang.label}</Text>
                <Text style={[typography.bodyStrong, language === lang.code ? styles.radioOn : styles.radioOff]}>
                  {language === lang.code ? "●" : "○"}
                </Text>
              </Pressable>
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
        </>
      )}

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
  screenMobileTint: { backgroundColor: colors.indigo[100] },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, width: "100%", alignSelf: "center" },
  contentDesktop: { padding: spacing.xxl, paddingBottom: spacing.xxl, maxWidth: 1000, gap: spacing.lg },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg },
  title: { color: colors.textPrimary },
  identityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
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
  displayName: { color: colors.textPrimary },
  displayEmail: { color: colors.textSecondary, marginTop: 2 },
  sectionHeader: { color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm },
  rowLabel: { color: colors.textPrimary },
  rowLabelDanger: { color: colors.danger },
  rowValue: { color: colors.textSecondary },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  chevron: { color: colors.textSecondary, fontSize: 16 },
  radioOn: { color: colors.terracotta[400] },
  radioOff: { color: colors.textSecondary },
  logoutChip: {
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  logoutChipText: { color: colors.danger, fontWeight: "700", fontSize: 13 },
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
  desktopSubtitle: { color: colors.textSecondary, marginTop: -spacing.sm },
  desktopGridRow: { flexDirection: "row", gap: spacing.lg, alignItems: "stretch" },
  desktopCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  desktopCardTitle: { color: colors.textPrimary, marginBottom: spacing.sm },
  desktopCardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  meterBox: { backgroundColor: colors.background, borderRadius: radius.md, padding: spacing.md },
  meterBoxLabel: { color: colors.textSecondary },
  meterBoxValue: { color: colors.indigo[900], marginTop: 2 },
  meterStatusRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  meterStatusText: { color: colors.success },
  unbindButtonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  unbindButtonText: { color: colors.danger },
  languageBox: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  exportHint: { color: colors.textSecondary, marginBottom: spacing.sm },
  csvExportButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  csvExportButtonText: { color: colors.indigo[500] },
  desktopFooter: { flexDirection: "row", alignItems: "center", gap: spacing.lg, justifyContent: "center", marginTop: spacing.md },
  footerLink: { color: colors.indigo[500] },
  fieldLabel: { color: colors.textSecondary, marginBottom: spacing.xs },
});
