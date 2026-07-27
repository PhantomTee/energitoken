import React from "react";
import { Tabs, Redirect } from "expo-router";
import { ColorValue } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../src/theme/colors";
import { fonts, spacing } from "../../src/theme/typography";
import { useWallet } from "../../src/hooks/useWallet";
import { BrandSplash } from "../../src/components/BrandSplash";
import { useIsDesktopWeb } from "../../src/hooks/useIsDesktopWeb";

const SIDEBAR_WIDTH = 224;

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
  );
}
