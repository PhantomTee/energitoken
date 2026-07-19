import "../polyfills";
import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
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
    <SafeAreaProvider>
      <PrivyProvider
        appId={PRIVY_APP_ID}
        clientId={PRIVY_MOBILE_CLIENT_ID}
        supportedChains={privySupportedChains}
        config={{ embedded: { ethereum: { createOnLogin: "users-without-wallets" } } }}
      >
        <StatusBar style="light" />
        {/* edges=["top"] only -- each tab screen/ScrollView already handles its
            own bottom padding, and the tab bar sits at the true screen bottom. */}
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
            <Stack.Screen name="login" />
            <Stack.Screen name="unlock" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="(tabs)" />
          </Stack>
        </SafeAreaView>
      </PrivyProvider>
    </SafeAreaProvider>
  );
}
