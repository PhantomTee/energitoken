import "../polyfills";
import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { PrivyProvider } from "@privy-io/expo";
import { PRIVY_APP_ID, PRIVY_MOBILE_CLIENT_ID, privySupportedChains } from "../config/privy";
import { colors } from "../theme/colors";
import { useAppFonts } from "../theme/useAppFonts";
import { BrandSplash } from "../components/BrandSplash";

// Keep the native splash (a flat #121022 fill, configured in app.json) up
// until fonts are ready, then hand off to BrandSplash — same color, so the
// cold-start screen and the JS splash read as one continuous screen rather
// than a white flash followed by a dark one.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useAppFonts();

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

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
        <Stack.Screen name="unlock" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </PrivyProvider>
  );
}
