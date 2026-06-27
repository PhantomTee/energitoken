import React from "react";
import { Redirect } from "expo-router";
import { useWallet } from "../src/hooks/useWallet";
import { BrandSplash } from "../src/components/BrandSplash";

/** Entry point: route to the dashboard if already logged in, else to login. */
export default function Index() {
  const { isReady, isAuthenticated } = useWallet();

  if (!isReady) {
    return <BrandSplash />;
  }

  return <Redirect href={isAuthenticated ? "/(tabs)/dashboard" : "/login"} />;
}
