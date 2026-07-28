import React from "react";
import { Tabs, Redirect } from "expo-router";
import { View, Text, ColorValue, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/theme/colors";
import { typography, fonts, spacing } from "../../src/theme/typography";
import { useWallet } from "../../src/hooks/useWallet";
import { BrandSplash } from "../../src/components/BrandSplash";
import { useIsDesktopWeb } from "../../src/hooks/useIsDesktopWeb";
import { displayNameFromEmail } from "../../src/services/displayName";

const SIDEBAR_WIDTH = 224;

/** Every desktop mockup pins a small identity block to the bottom of the
 * sidebar. expo-router's Tabs doesn't expose a way to inject content into
 * the tab bar itself, so this renders as a fixed-position sibling instead of
 * fighting the navigator internals -- web-only positioning, matching the
 * sidebar's own width exactly. */
function SidebarFooter() {
  const { email } = useWallet();
  const name = displayNameFromEmail(email);
  return (
    <View style={styles.sidebarFooter}>
      <View style={styles.sidebarFooterAvatar}>
        <Text style={styles.sidebarFooterAvatarText}>{name.charAt(0)}</Text>
      </View>
      <View>
        <Text style={[typography.bodyStrong, styles.sidebarFooterName]}>{name}</Text>
        <Text style={[typography.caption, styles.sidebarFooterRole]}>User Account</Text>
      </View>
    </View>
  );
}

function TabIcon({ name, color }: { name: keyof typeof Ionicons.glyphMap; color: ColorValue }) {
  return <Ionicons name={name} size={20} color={color} />;
}

/** On native, and on web below the desktop breakpoint, this renders as an
 * ordinary bottom tab bar. On web at desktop width the same Tabs navigator
 * is restyled into a fixed left sidebar -- same routes, same navigation
 * state, just laid out differently -- so there's one source of truth for
 * the app's screens instead of a parallel web-only nav tree. Gating on
 * viewport width (not just Platform.OS === "web") matters because a phone
 * browser is still "web" and needs the same compact layout as native. */
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
        tabBarPosition: isDesktop ? "left" : "bottom",
        tabBarStyle: isDesktop
          ? {
              backgroundColor: colors.surface,
              borderRightWidth: 1,
              borderRightColor: colors.border,
              borderTopWidth: 0,
              width: SIDEBAR_WIDTH,
              paddingTop: spacing.xl,
            }
          : { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelPosition: isDesktop ? "beside-icon" : undefined,
        tabBarItemStyle: isDesktop
          ? { flexDirection: "row", justifyContent: "flex-start", paddingHorizontal: spacing.lg, height: 48 }
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
      <Tabs.Screen
        name="history"
        options={{ title: "Consumption", tabBarIcon: ({ color }) => <TabIcon name="time-outline" color={color} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Settings", tabBarIcon: ({ color }) => <TabIcon name="settings-outline" color={color} /> }}
      />
    </Tabs>
    {isDesktop && <SidebarFooter />}
    </View>
  );
}

const styles = StyleSheet.create({
  sidebarFooter: {
    position: "fixed" as "absolute",
    left: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  sidebarFooterAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.terracotta[500],
    alignItems: "center",
    justifyContent: "center",
  },
  sidebarFooterAvatarText: { color: colors.neutral.white, fontWeight: "700", fontSize: 13 },
  sidebarFooterName: { color: colors.textPrimary, fontSize: 13 },
  sidebarFooterRole: { color: colors.textSecondary },
});
