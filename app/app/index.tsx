import React from "react";
import { Redirect } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { useWallet } from "../src/hooks/useWallet";
import { colors } from "../src/theme/colors";

/** Entry point: route to the dashboard if already logged in, else to login. */
export default function Index() {
  const { isReady, isAuthenticated } = useWallet();

  if (!isReady) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.indigo[500]} />
      </View>
    );
  }

  return <Redirect href={isAuthenticated ? "/(tabs)/dashboard" : "/login"} />;
}
