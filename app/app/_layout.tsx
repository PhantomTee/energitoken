import "../src/polyfills";
import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PrivyProvider } from "@privy-io/expo";
import { PRIVY_APP_ID, privySupportedChains } from "../src/config/privy";

export default function RootLayout() {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      supportedChains={privySupportedChains}
      config={{ embedded: { ethereum: { createOnLogin: "users-without-wallets" } } }}
    >
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </PrivyProvider>
  );
}
