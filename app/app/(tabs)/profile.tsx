import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { router } from "expo-router";
import { colors } from "../../src/theme/colors";
import { typography, spacing, radius } from "../../src/theme/typography";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { CopyableField } from "../../src/components/CopyableField";
import { useWallet } from "../../src/hooks/useWallet";
import { getDeviceForWallet } from "../../src/services/deviceBinding";
import { clearFirebaseSession } from "../../src/services/firebaseSession";
import { displayNameFromEmail } from "../../src/services/displayName";

const APP_VERSION = "EnergiToken v1.0 — Polygon Amoy";

/**
 * Everything a household might need to hand to someone else verbatim —
 * to add a second person to the account, register the meter, or get
 * support.
 */
export default function ProfileScreen() {
  const { email, walletAddress, logout } = useWallet();
  const [deviceId, setDeviceId] = useState<string | null | undefined>(undefined);
  const displayName = displayNameFromEmail(email);

  useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;
    getDeviceForWallet(walletAddress)
      .then((id) => {
        if (!cancelled) setDeviceId(id);
      })
      .catch(() => {
        if (!cancelled) setDeviceId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  const handleLogout = async () => {
    await clearFirebaseSession();
    await logout();
    router.replace("/login");
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.titleRow}>
        <Text style={[typography.h1, styles.title]}>Profile</Text>
        <AdinkraAccent size={28} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
      </View>
      <Text style={[typography.body, styles.subtitle]}>
        Your account details — share these to add someone to your household or register your meter.
      </Text>

      <View style={styles.identityCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{displayName.charAt(0)}</Text>
        </View>
        <View>
          <Text style={[typography.h2, styles.displayName]}>{displayName}</Text>
          <Text style={[typography.caption, styles.displayEmail]}>{email ?? "Not linked"}</Text>
        </View>
      </View>

      <View style={styles.fields}>
        <CopyableField label="Email" value={email ?? "Not linked"} mono={false} />
        <CopyableField label="Wallet address" value={walletAddress ?? "—"} />
        <CopyableField
          label="Meter device code"
          value={deviceId === undefined ? "Loading…" : deviceId ?? "Not paired yet"}
        />
      </View>

      <Pressable style={styles.logoutButton} onPress={handleLogout}>
        <Text style={[typography.bodyStrong, styles.logoutText]}>Log out</Text>
      </Pressable>

      <Text style={[typography.caption, styles.versionText]}>{APP_VERSION}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { color: colors.textSecondary, marginBottom: spacing.lg },
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
  fields: { gap: spacing.md },
  logoutButton: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.xl,
  },
  logoutText: { color: colors.danger },
  versionText: { color: colors.textSecondary, opacity: 0.6, textAlign: "center", marginTop: spacing.lg },
});
