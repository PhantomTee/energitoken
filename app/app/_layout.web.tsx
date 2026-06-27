import "../src/polyfills";
import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PrivyProvider } from "@privy-io/react-auth";
import { PRIVY_APP_ID, privySupportedChains } from "../src/config/privy";

export default function RootLayout() {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        supportedChains: privySupportedChains,
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
      }}
    >
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </PrivyProvider>
  );
}
