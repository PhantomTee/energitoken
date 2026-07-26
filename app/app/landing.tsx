import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Platform } from "react-native";
import { useRouter, Redirect } from "expo-router";
import { colors } from "../src/theme/colors";
import { typography, spacing, radius } from "../src/theme/typography";
import { AdinkraAccent } from "../src/theme/motifs/AdinkraAccent";

const FEATURES = [
  {
    icon: "⚡",
    title: "Live metering",
    body: "Voltage, current, power and frequency update in real time from your household's meter.",
  },
  {
    icon: "◐",
    title: "Budgeted, not blacked out",
    body: "Set a daily budget. As usage approaches it, non-critical loads shed gently -- lighting and phone charging protected to the very end.",
  },
  {
    icon: "⇄",
    title: "Share credit like airtime",
    body: "Send surplus watt-hours to another household by email, wallet address, or QR code.",
  },
  {
    icon: "≡",
    title: "A real record",
    body: "Every top-up, transfer, and unit consumed is a transaction on Polygon -- verifiable, not just a number in an app.",
  },
] as const;

/** Web-only marketing landing page shown before login. Native skips this
 * entirely -- first-run users get the app/welcome.tsx carousel instead, and
 * this route redirects straight to /login there. */
export default function LandingScreen() {
  const router = useRouter();

  if (Platform.OS !== "web") {
    return <Redirect href="/login" />;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.nav}>
        <View style={styles.brandRow}>
          <AdinkraAccent size={24} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
          <Text style={[typography.label, styles.brandLabel]}>ENERGITOKEN</Text>
        </View>
        <Pressable style={styles.navButton} onPress={() => router.push("/login")}>
          <Text style={[typography.bodyStrong, styles.navButtonText]}>Sign in</Text>
        </Pressable>
      </View>

      <View style={styles.hero}>
        <Text style={[typography.display, styles.heroTitle]}>Power, budgeted{"\n"}and shared.</Text>
        <Text style={[typography.body, styles.heroSubtitle]}>
          EnergiToken turns prepaid electricity into a household credit balance you can see, budget,
          and share -- backed by a real smart meter, not a guess.
        </Text>
        <Pressable style={styles.heroButton} onPress={() => router.push("/login")}>
          <Text style={[typography.bodyStrong, styles.heroButtonText]}>Get started</Text>
        </Pressable>
      </View>

      <View style={styles.featureGrid}>
        {FEATURES.map((f) => (
          <View key={f.title} style={styles.featureCard}>
            <Text style={styles.featureIcon}>{f.icon}</Text>
            <Text style={[typography.bodyStrong, styles.featureTitle]}>{f.title}</Text>
            <Text style={[typography.caption, styles.featureBody]}>{f.body}</Text>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={[typography.caption, styles.footerText]}>
          Your energy. Your budget. Your control.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.indigo[900] },
  content: { paddingBottom: spacing.xxl, alignItems: "center" },
  nav: {
    width: "100%",
    maxWidth: 1080,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandLabel: { color: colors.terracotta[300] },
  navButton: {
    borderWidth: 1,
    borderColor: colors.indigo[400],
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  navButtonText: { color: colors.neutral.white },
  hero: {
    width: "100%",
    maxWidth: 720,
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  heroTitle: { color: colors.neutral.white, textAlign: "center", marginBottom: spacing.md },
  heroSubtitle: { color: colors.indigo[100], textAlign: "center", opacity: 0.85, marginBottom: spacing.xl },
  heroButton: {
    backgroundColor: colors.terracotta[400],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
  },
  heroButtonText: { color: colors.neutral.white },
  featureGrid: {
    width: "100%",
    maxWidth: 1080,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    justifyContent: "center",
  },
  featureCard: {
    width: 240,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  featureIcon: { fontSize: 28 },
  featureTitle: { color: colors.neutral.white },
  featureBody: { color: colors.indigo[100], opacity: 0.8 },
  footer: { marginTop: spacing.xxl, paddingHorizontal: spacing.xl },
  footerText: { color: colors.indigo[300], opacity: 0.7 },
});
