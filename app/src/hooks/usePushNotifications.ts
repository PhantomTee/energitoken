import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { savePushToken } from "../services/pushTokens";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Requests notification permission and registers this device's Expo push
 * token against the wallet (see app/api/_lib/notify.ts, which reads
 * /pushTokens/{wallet} to send pushes for top-ups, consumption, and
 * budget-threshold alerts). Native only — web push uses a different,
 * unimplemented standard.
 *
 * Safe to call on every dashboard mount; re-registers if the token rotates.
 */
export function usePushNotifications(walletAddress: string | null) {
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!walletAddress || !Device.isDevice) return;
    if (registeredFor.current === walletAddress) return;

    let cancelled = false;

    (async () => {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        let status = existing;
        if (status !== "granted") {
          const result = await Notifications.requestPermissionsAsync();
          status = result.status;
        }
        if (status !== "granted" || cancelled) return;

        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", {
            name: "EnergiToken alerts",
            importance: Notifications.AndroidImportance.HIGH,
          });
        }

        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined
        );

        if (cancelled) return;
        await savePushToken(walletAddress, expoPushToken);
        registeredFor.current = walletAddress;
      } catch {
        // Non-critical: in-app notifications still work without push.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);
}
