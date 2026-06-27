import "../polyfills";
import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PrivyProvider } from "@privy-io/expo";
import { PRIVY_APP_ID, PRIVY_MOBILE_CLIENT_ID, privySupportedChains } from "../config/privy";
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
      clientId={PRIVY_MOBILE_CLIENT_ID}
      supportedChains={privySupportedChains}
      config={{ embedded: { ethereum: { createOnLogin: "users-without-wallets" } } }}
    >
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </PrivyProvider>
  );
}
