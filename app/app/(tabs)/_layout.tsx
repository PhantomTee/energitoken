import React from "react";
import { Tabs } from "expo-router";
import { Text, ColorValue } from "react-native";
import { colors } from "../../src/theme/colors";

function TabIcon({ symbol, color }: { symbol: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{symbol}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.indigo[700],
        tabBarInactiveTintColor: colors.neutral[500],
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{ title: "Dashboard", tabBarIcon: ({ color }) => <TabIcon symbol="⌂" color={color} /> }}
      />
      <Tabs.Screen
        name="transfer"
        options={{ title: "Transfer", tabBarIcon: ({ color }) => <TabIcon symbol="⇄" color={color} /> }}
      />
      <Tabs.Screen
        name="history"
        options={{ title: "History", tabBarIcon: ({ color }) => <TabIcon symbol="≡" color={color} /> }}
      />
    </Tabs>
  );
}
