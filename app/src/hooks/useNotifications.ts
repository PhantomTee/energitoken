import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { apiRequest } from "../services/apiClient";

export type AppNotification = {
  id: string;
  type: "topup" | "consumption" | "shed_warning" | "transfer" | "device";
  title: string;
  body: string;
  read: boolean;
  createdAt: number;
};

const POLL_INTERVAL_MS = 8000;

/**
 * In-app notifications for the signed-in wallet. Server functions write to
 * /notifications/{wallet} (see app/api/_lib/notify.ts); this hook polls
 * /api/data?resource=notifications (server-side, Admin SDK) for the
 * latest 50, newest first, instead of a direct Firebase realtime listener.
 */
export function useNotifications(walletAddress: string | null, getSigner: () => Promise<ethers.Signer>) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!walletAddress) {
      setNotifications([]);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const result = await apiRequest<{ notifications: AppNotification[] }>(
          "/api/data?resource=notifications",
          walletAddress,
          getSigner
        );
        if (!cancelled) setNotifications(result.notifications);
      } catch {
        // Leave the previous list on screen rather than clearing it on a transient error.
      } finally {
        inFlightRef.current = false;
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [walletAddress]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const markAllRead = async () => {
    if (!walletAddress) return;
    const ids = notifications.filter((n) => !n.read).map((n) => n.id);
    if (ids.length === 0) return;
    setNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
    await apiRequest("/api/data", walletAddress, getSigner, {
      method: "POST",
      body: { resource: "notifications", action: "mark-read", ids },
    }).catch(() => {/* non-critical */});
  };

  return { notifications, unreadCount, markAllRead };
}
