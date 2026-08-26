import React from "react";
import { Tabs, Redirect, useRouter } from "expo-router";
import { View, Text, Pressable, ColorValue, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/theme/colors";
import { typography, fonts, spacing } from "../../src/theme/typography";
import { useWallet } from "../../src/hooks/useWallet";
import { BrandSplash } from "../../src/components/BrandSplash";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";
import { useIsDesktopWeb } from "../../src/hooks/useIsDesktopWeb";
import { displayNameFromEmail } from "../../src/services/displayName";

const NAVBAR_HEIGHT = 64;
const NAVBAR_BRAND_WIDTH = 200;
const NAVBAR_ACCOUNT_WIDTH = 180;

/** expo-router's Tabs doesn't expose a way to inject content into the tab
 * bar itself, so the brand mark and account block render as fixed-position
 * siblings either side of it -- same width the tab bar's own padding leaves
 * clear, so visually it reads as one navbar even though it's three pieces. */
function NavbarBrand() {
  const router = useRouter();
  return (
    <Pressable style={styles.navbarBrand} onPress={() => router.push("/landing")}>
      <AdinkraAccent size={26} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
      <Text style={[typography.bodyStrong, styles.navbarBrandText]}>ENERGITOKEN</Text>
    </Pressable>
  );
}

function NavbarAccount() {
  const { email } = useWallet();
  const name = displayNameFromEmail(email);
  return (
    <View style={styles.navbarAccount}>
      <View style={styles.navbarAccountAvatar}>
        <Text style={styles.navbarAccountAvatarText}>{name.charAt(0)}</Text>
      </View>
      <View>
        <Text style={[typography.bodyStrong, styles.navbarAccountName]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[typography.caption, styles.navbarAccountRole]}>User Account</Text>
      </View>
    </View>
  );
}

function TabIcon({ name, color }: { name: keyof typeof Ionicons.glyphMap; color: ColorValue }) {
  return <Ionicons name={name} size={20} color={color} />;
}

/** On native, and on web below the desktop breakpoint, this renders as an
 * ordinary bottom tab bar. On web at desktop width the same Tabs navigator
 * is restyled into a top navbar -- same routes, same navigation state, just
 * laid out differently -- so there's one source of truth for the app's
 * screens instead of a parallel web-only nav tree. Gating on viewport width
 * (not just Platform.OS === "web") matters because a phone browser is still
 * "web" and needs the same compact layout as native. */
export default function TabsLayout() {
  const { isReady, isAuthenticated } = useWallet();
  const isDesktop = useIsDesktopWeb();

  if (!isReady) {
    return <BrandSplash />;
  }
  if (!isAuthenticated) {
    return <Redirect href="/login" />;
  }

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.terracotta[400],
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarPosition: isDesktop ? "top" : "bottom",
        tabBarStyle: isDesktop
          ? {
              backgroundColor: colors.surface,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              borderTopWidth: 0,
              height: NAVBAR_HEIGHT,
              paddingLeft: NAVBAR_BRAND_WIDTH,
              paddingRight: NAVBAR_ACCOUNT_WIDTH,
            }
          : { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelPosition: isDesktop ? "beside-icon" : undefined,
        tabBarItemStyle: isDesktop
          ? { flexDirection: "row", justifyContent: "center", paddingHorizontal: spacing.lg }
          : undefined,
        tabBarLabelStyle: {
          fontFamily: fonts.displayMedium,
          fontSize: isDesktop ? 14 : 11,
          marginLeft: isDesktop ? spacing.sm : 0,
        },
        tabBarIconStyle: isDesktop ? { marginRight: 0 } : undefined,
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{ title: "Overview", tabBarIcon: ({ color }) => <TabIcon name="home-outline" color={color} /> }}
      />
      <Tabs.Screen
        name="budget"
        options={{ title: "Budget", tabBarIcon: ({ color }) => <TabIcon name="pie-chart-outline" color={color} /> }}
      />
      <Tabs.Screen
        name="transfer"
        options={{
          title: "Transfers",
          tabBarIcon: ({ color }) => <TabIcon name="swap-horizontal-outline" color={color} />,
        }}
      />
      {/* href: null keeps this a real, navigable route (linked from Profile's
          "Transaction History" row) without giving it its own tab-bar icon --
          the app is meant to stay at 4 visible tabs. */}
      <Tabs.Screen name="history" options={{ href: null }} />
      <Tabs.Screen
        name="profile"
        options={{ title: "Settings", tabBarIcon: ({ color }) => <TabIcon name="settings-outline" color={color} /> }}
      />
    </Tabs>
    {isDesktop && <NavbarBrand />}
    {isDesktop && <NavbarAccount />}
    </View>
  );
}

const styles = StyleSheet.create({
  navbarBrand: {
    position: "fixed" as "absolute",
    top: 0,
    left: 0,
    width: NAVBAR_BRAND_WIDTH,
    height: NAVBAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    zIndex: 10,
  },
  navbarBrandText: { color: colors.textPrimary, letterSpacing: 0.5, fontSize: 14 },
  navbarAccount: {
    position: "fixed" as "absolute",
    top: 0,
    right: 0,
    width: NAVBAR_ACCOUNT_WIDTH,
    height: NAVBAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    zIndex: 10,
  },
  navbarAccountAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.terracotta[500],
    alignItems: "center",
    justifyContent: "center",
  },
  navbarAccountAvatarText: { color: colors.neutral.white, fontWeight: "700", fontSize: 13 },
  navbarAccountName: { color: colors.textPrimary, fontSize: 13, maxWidth: 110 },
  navbarAccountRole: { color: colors.textSecondary },
});
