import "../polyfills";
import React from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PrivyProvider } from "@privy-io/react-auth";
import { PRIVY_APP_ID, privySupportedChains } from "../config/privy";
import { colors } from "../theme/colors";
import { useAppFonts } from "../theme/useAppFonts";
import { BrandSplash } from "../components/BrandSplash";

export default function RootLayout() {
  const [fontsLoaded] = useAppFonts();

  if (!fontsLoaded) {
    return <BrandSplash />;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        supportedChains: privySupportedChains,
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
      }}
    >
      <StatusBar style="light" />
      {/* Fixed top padding on web -- no notch/status bar to measure, but the
          app felt cramped flush against the browser chrome without it. */}
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: 70 }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Screen name="login" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </View>
    </PrivyProvider>
  );
}
