import React from "react";
import { Tabs, Redirect } from "expo-router";
import { Text, ColorValue } from "react-native";
import { colors } from "../../src/theme/colors";
import { fonts } from "../../src/theme/typography";
import { useWallet } from "../../src/hooks/useWallet";
import { BrandSplash } from "../../src/components/BrandSplash";

function TabIcon({ symbol, color }: { symbol: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{symbol}</Text>;
}

export default function TabsLayout() {
  const { isReady, isAuthenticated } = useWallet();

  // Guard every tab: direct URL entry, expired session, or logout elsewhere
  // all land back on /login instead of rendering an empty dashboard.
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
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fonts.displayMedium, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{ title: "Dashboard", tabBarIcon: ({ color }) => <TabIcon symbol="⌂" color={color} /> }}
      />
      <Tabs.Screen
        name="budget"
        options={{ title: "Budget", tabBarIcon: ({ color }) => <TabIcon symbol="◐" color={color} /> }}
      />
      <Tabs.Screen
        name="transfer"
        options={{ title: "Transfer", tabBarIcon: ({ color }) => <TabIcon symbol="⇄" color={color} /> }}
      />
      <Tabs.Screen
        name="history"
        options={{ title: "History", tabBarIcon: ({ color }) => <TabIcon symbol="≡" color={color} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Profile", tabBarIcon: ({ color }) => <TabIcon symbol="◎" color={color} /> }}
      />
    </Tabs>
  );
}
