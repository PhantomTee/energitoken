import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Platform, Linking, useWindowDimensions } from "react-native";
import { useRouter, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../src/theme/colors";
import { typography, spacing, radius } from "../src/theme/typography";
import { AdinkraAccent } from "../src/theme/motifs/AdinkraAccent";
import { CONTRACT_ADDRESS } from "../src/services/contract";

const EXPLORER_URL = `https://amoy.polygonscan.com/address/${CONTRACT_ADDRESS}`;
const GITHUB_URL = "https://github.com/PhantomTee/energitoken";

const FEATURES = [
  {
    icon: "stats-chart-outline" as const,
    title: "Track",
    body: "Real-time meter readings direct to your dashboard. Monitor kWh usage instantly with high-precision data streams.",
  },
  {
    icon: "pie-chart-outline" as const,
    title: "Budget",
    body: "Set firm consumption limits. Automated relay shedding protection kicks in before you exceed your allowance, saving costs.",
  },
  {
    icon: "swap-horizontal-outline" as const,
    title: "Share",
    body: "Excess capacity? Transfer surplus energy tokens directly wallet-to-wallet with peers in your micro-grid instantly.",
  },
] as const;

const STEPS = [
  { n: 1, title: "Top Up", body: "Add EnergiTokens to your secure digital wallet.", accent: "terracotta" },
  { n: 2, title: "Set Budget", body: "Allocate tokens to specific appliances or timeframes.", accent: "indigo" },
  { n: 3, title: "Meter Enforces", body: "Smart relay automatically manages supply based on limits.", accent: "indigo" },
  { n: 4, title: "Share Surplus", body: "Send unused tokens back to the community grid.", accent: "terracotta" },
] as const;

/** Web-only marketing landing page shown before login. Native skips this
 * entirely -- first-run users get the app/welcome.tsx carousel instead, and
 * this route redirects straight to /login there. */
export default function LandingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isNarrow = width < 700;
  const scrollRef = useRef<ScrollView>(null);
  const [sectionY, setSectionY] = useState<{ features: number; steps: number }>({ features: 0, steps: 0 });

  if (Platform.OS !== "web") {
    return <Redirect href="/login" />;
  }

  const scrollToSection = (key: "features" | "steps") => {
    scrollRef.current?.scrollTo({ y: sectionY[key], animated: true });
  };

  return (
    <ScrollView ref={scrollRef} style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.nav}>
        <View style={styles.brandRow}>
          <AdinkraAccent size={26} color={colors.terracotta[500]} dotColor={colors.indigo[500]} opacity={1} />
          <Text style={[typography.h2, styles.brandLabel]}>EnergiToken</Text>
        </View>
        <View style={styles.navRight}>
          {!isNarrow && (
            <>
              <Pressable onPress={() => scrollToSection("features")}>
                <Text style={[typography.body, styles.navLink]}>Features</Text>
              </Pressable>
              <Pressable onPress={() => scrollToSection("steps")}>
                <Text style={[typography.body, styles.navLink]}>How it Works</Text>
              </Pressable>
            </>
          )}
          <Pressable style={styles.navCta} onPress={() => router.push("/login")}>
            <Text style={[typography.bodyStrong, styles.navCtaText]}>Get Started</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Hero ── */}
      <View style={[styles.hero, isNarrow && styles.heroNarrow]}>
        <View style={[styles.heroLeft, isNarrow && styles.heroLeftNarrow]}>
          <Text style={[typography.display, styles.heroTitle, isNarrow && styles.heroTitleNarrow]}>
            Powering Your Future.{"\n"}
            <Text style={styles.heroTitleAccent}>Track. Budget. Share.</Text>
          </Text>
          <Text style={[typography.body, styles.heroSubtitle, isNarrow && styles.heroSubtitleNarrow]}>
            Take control of your energy consumption with EnergiToken. Real-time monitoring,
            intelligent relay shedding, and seamless wallet-to-wallet surplus sharing in one unified
            platform.
          </Text>
          <View style={[styles.heroButtons, isNarrow && styles.heroButtonsNarrow]}>
            <Pressable style={styles.heroPrimaryButton} onPress={() => router.push("/login")}>
              <Text style={[typography.bodyStrong, styles.heroPrimaryButtonText]}>Get Started</Text>
            </Pressable>
          </View>
        </View>
        {!isNarrow && (
          <View style={styles.heroRight}>
            <View style={styles.heroArt}>
              <AdinkraAccent size={140} color={colors.indigo[300]} dotColor={colors.terracotta[400]} opacity={0.9} />
            </View>
          </View>
        )}
      </View>

      {/* ── Features ── */}
      <View
        style={styles.featuresSection}
        onLayout={(e) => setSectionY((prev) => ({ ...prev, features: e.nativeEvent.layout.y }))}
      >
        <Text style={[typography.h1, styles.sectionTitle]}>Intelligent Energy Management</Text>
        <Text style={[typography.body, styles.sectionSubtitle]}>
          Everything you need to monitor, control, and distribute your energy resources efficiently.
        </Text>
        <View style={styles.featureGrid}>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.featureCard}>
              <View style={styles.featureIconWrap}>
                <Ionicons name={f.icon} size={22} color={colors.indigo[700]} />
              </View>
              <Text style={[typography.h2, styles.featureTitle]}>{f.title}</Text>
              <Text style={[typography.body, styles.featureBody]}>{f.body}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── How It Works ── */}
      <View
        style={styles.stepsSection}
        onLayout={(e) => setSectionY((prev) => ({ ...prev, steps: e.nativeEvent.layout.y }))}
      >
        <Text style={[typography.h1, styles.sectionTitle]}>How It Works</Text>
        <View style={styles.stepsRow}>
          {STEPS.map((s) => (
            <View key={s.n} style={styles.stepCol}>
              <View
                style={[
                  styles.stepCircle,
                  { borderColor: s.accent === "terracotta" ? colors.terracotta[500] : colors.indigo[500] },
                ]}
              >
                <Text
                  style={[
                    typography.dataMd,
                    { color: s.accent === "terracotta" ? colors.terracotta[500] : colors.indigo[500] },
                  ]}
                >
                  {s.n}
                </Text>
              </View>
              <Text style={[typography.h2, styles.stepTitle]}>{s.title}</Text>
              <Text style={[typography.caption, styles.stepBody]}>{s.body}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Footer ── */}
      <View style={styles.footer}>
        <View style={styles.footerBrandRow}>
          <AdinkraAccent size={20} color={colors.terracotta[500]} dotColor={colors.indigo[500]} opacity={1} />
          <Text style={[typography.bodyStrong, styles.footerBrand]}>EnergiToken</Text>
        </View>
        <View style={styles.footerLinks}>
          <Pressable onPress={() => Linking.openURL(EXPLORER_URL)}>
            <Text style={[typography.dataXs, styles.footerLink]}>
              {CONTRACT_ADDRESS.slice(0, 6)}…{CONTRACT_ADDRESS.slice(-4)}
            </Text>
          </Pressable>
          <Pressable onPress={() => Linking.openURL(GITHUB_URL)}>
            <Text style={[typography.dataXs, styles.footerLink]}>GitHub</Text>
          </Pressable>
          <Text style={[typography.dataXs, styles.footerLink]}>hello@energitoken.io</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { alignItems: "center" },
  nav: {
    width: "100%",
    maxWidth: 1180,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandLabel: { color: colors.indigo[900] },
  navRight: { flexDirection: "row", alignItems: "center", gap: spacing.xl },
  navLink: { color: colors.textSecondary },
  navCta: {
    backgroundColor: colors.terracotta[500],
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  navCtaText: { color: colors.neutral.white },

  hero: {
    width: "100%",
    maxWidth: 1180,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  heroNarrow: { paddingVertical: spacing.xl },
  heroLeft: { flex: 1, gap: spacing.lg, minWidth: 320 },
  heroLeftNarrow: { minWidth: 0, alignItems: "center" },
  heroTitle: { color: colors.indigo[900], fontSize: 44, lineHeight: 50 },
  heroTitleNarrow: { fontSize: 30, lineHeight: 36, textAlign: "center" },
  heroTitleAccent: { color: colors.terracotta[500] },
  heroSubtitle: { color: colors.textSecondary, maxWidth: 460 },
  heroSubtitleNarrow: { textAlign: "center" },
  heroButtons: { flexDirection: "row", gap: spacing.md, flexWrap: "wrap" },
  heroButtonsNarrow: { justifyContent: "center" },
  heroPrimaryButton: {
    backgroundColor: colors.terracotta[500],
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  heroPrimaryButtonText: { color: colors.neutral.white },
  heroRight: { flex: 1, minWidth: 280, alignItems: "center" },
  heroArt: {
    width: "100%",
    maxWidth: 420,
    height: 320,
    borderRadius: radius.lg,
    backgroundColor: colors.indigo[100],
    alignItems: "center",
    justifyContent: "center",
  },

  featuresSection: {
    width: "100%",
    backgroundColor: colors.surface,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sectionTitle: { color: colors.indigo[900], textAlign: "center" },
  sectionSubtitle: { color: colors.textSecondary, textAlign: "center", marginTop: spacing.sm, maxWidth: 560 },
  featureGrid: {
    width: "100%",
    maxWidth: 1080,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    marginTop: spacing.xl,
    justifyContent: "center",
  },
  featureCard: {
    flexBasis: 300,
    flexGrow: 1,
    minWidth: 260,
    maxWidth: 340,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  featureIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.indigo[100],
    alignItems: "center",
    justifyContent: "center",
  },
  featureTitle: { color: colors.indigo[900] },
  featureBody: { color: colors.textSecondary },

  stepsSection: {
    width: "100%",
    maxWidth: 1180,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    alignItems: "center",
  },
  stepsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xl,
    justifyContent: "center",
    marginTop: spacing.xl,
  },
  stepCol: { alignItems: "center", width: 220, gap: spacing.sm },
  stepCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  stepTitle: { color: colors.indigo[900] },
  stepBody: { color: colors.textSecondary, textAlign: "center" },

  footer: {
    width: "100%",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    gap: spacing.md,
  },
  footerBrandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  footerBrand: { color: colors.indigo[900] },
  footerLinks: { flexDirection: "row", gap: spacing.lg, flexWrap: "wrap", justifyContent: "center" },
  footerLink: { color: colors.textSecondary },
});
