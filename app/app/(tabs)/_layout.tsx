import React from "react";
import { Tabs, Redirect } from "expo-router";
import { Text, ColorValue, Platform } from "react-native";
import { colors } from "../../src/theme/colors";
import { fonts, spacing } from "../../src/theme/typography";
import { useWallet } from "../../src/hooks/useWallet";
import { BrandSplash } from "../../src/components/BrandSplash";

const isWeb = Platform.OS === "web";
const SIDEBAR_WIDTH = 224;

function TabIcon({ symbol, color }: { symbol: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{symbol}</Text>;
}

/** On native this renders as an ordinary bottom tab bar. On web the same
 * Tabs navigator is restyled into a fixed left sidebar -- same routes, same
 * navigation state, just laid out differently -- so there's one source of
 * truth for the app's screens instead of a parallel web-only nav tree. */
export default function TabsLayout() {
  const { isReady, isAuthenticated } = useWallet();

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
        tabBarPosition: isWeb ? "left" : "bottom",
        tabBarStyle: isWeb
          ? {
              backgroundColor: colors.surface,
              borderRightWidth: 1,
              borderRightColor: colors.border,
              borderTopWidth: 0,
              width: SIDEBAR_WIDTH,
              paddingTop: spacing.xl,
            }
          : { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelPosition: isWeb ? "beside-icon" : undefined,
        tabBarItemStyle: isWeb
          ? { flexDirection: "row", justifyContent: "flex-start", paddingHorizontal: spacing.lg, height: 48 }
          : undefined,
        tabBarLabelStyle: {
          fontFamily: fonts.displayMedium,
          fontSize: isWeb ? 14 : 11,
          marginLeft: isWeb ? spacing.sm : 0,
        },
        tabBarIconStyle: isWeb ? { marginRight: 0 } : undefined,
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{ title: "Overview", tabBarIcon: ({ color }) => <TabIcon symbol="⌂" color={color} /> }}
      />
      <Tabs.Screen
        name="budget"
        options={{ title: "Budget", tabBarIcon: ({ color }) => <TabIcon symbol="◐" color={color} /> }}
      />
      <Tabs.Screen
        name="transfer"
        options={{ title: "Transfers", tabBarIcon: ({ color }) => <TabIcon symbol="⇄" color={color} /> }}
      />
      <Tabs.Screen
        name="history"
        options={{ title: "Consumption", tabBarIcon: ({ color }) => <TabIcon symbol="≡" color={color} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Settings", tabBarIcon: ({ color }) => <TabIcon symbol="◎" color={color} /> }}
      />
    </Tabs>
  );
}
