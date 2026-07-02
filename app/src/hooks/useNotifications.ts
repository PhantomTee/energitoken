import { useEffect, useMemo, useState } from "react";
import { ref, onValue, query, orderByChild, limitToLast, update } from "firebase/database";
import { db } from "../services/firebase";

export type AppNotification = {
  id: string;
  type: "topup" | "consumption" | "shed_warning" | "transfer" | "device";
  title: string;
  body: string;
  read: boolean;
  createdAt: number;
};

/**
 * Live in-app notifications for the signed-in wallet. Server functions write
 * to /notifications/{wallet} (see app/api/_lib/notify.ts); this hook keeps the
 * latest 50 in state, newest first. Requires ensureFirebaseSession to have
 * bound this session to the wallet, or reads will be denied by rules.
 */
export function useNotifications(walletAddress: string | null) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    if (!walletAddress) {
      setNotifications([]);
      return;
    }

    const q = query(
      ref(db, `notifications/${walletAddress}`),
      orderByChild("createdAt"),
      limitToLast(50)
    );

    const unsubscribe = onValue(
      q,
      (snapshot) => {
        const items: AppNotification[] = [];
        snapshot.forEach((child) => {
          const value = child.val();
          items.push({
            id: child.key as string,
            type: value.type ?? "topup",
            title: value.title ?? "",
            body: value.body ?? "",
            read: !!value.read,
            createdAt: value.createdAt ?? 0,
          });
        });
        items.sort((a, b) => b.createdAt - a.createdAt);
        setNotifications(items);
      },
      () => {
        // Permission denied (session not bound yet) — treat as empty rather
        // than crashing; the next ensureFirebaseSession call fixes access.
        setNotifications([]);
      }
    );

    return unsubscribe;
  }, [walletAddress]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const markAllRead = async () => {
    if (!walletAddress) return;
    const updates: Record<string, boolean> = {};
    for (const n of notifications) {
      if (!n.read) updates[`notifications/${walletAddress}/${n.id}/read`] = true;
    }
    if (Object.keys(updates).length > 0) {
      await update(ref(db), updates).catch(() => {/* non-critical */});
    }
  };

  return { notifications, unreadCount, markAllRead };
}
