import React, { useEffect } from "react";
import { Modal, View, Text, Pressable, StyleSheet, FlatList } from "react-native";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";
import { AppNotification } from "../hooks/useNotifications";

const TYPE_ICONS: Record<AppNotification["type"], string> = {
  topup: "↑",
  consumption: "⚡",
  shed_warning: "⚠",
  transfer: "⇄",
  device: "◎",
};

function formatWhen(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

type Props = {
  visible: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  onOpened: () => void; // mark-all-read once the panel is seen
};

export function NotificationsPanel({ visible, onClose, notifications, onOpened }: Props) {
  useEffect(() => {
    if (visible) onOpened();
  }, [visible, onOpened]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.panel} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={[typography.h2, styles.headerTitle]}>Notifications</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.closeButton}>✕</Text>
            </Pressable>
          </View>

          {notifications.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[typography.body, styles.emptyText]}>
                Nothing yet. Top-ups, energy use, and budget alerts will appear here.
              </Text>
            </View>
          ) : (
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              style={styles.list}
              renderItem={({ item }) => (
                <View style={[styles.item, !item.read && styles.itemUnread]}>
                  <Text style={[styles.itemIcon, item.type === "shed_warning" && styles.warnIcon]}>
                    {TYPE_ICONS[item.type]}
                  </Text>
                  <View style={styles.itemBody}>
                    <Text style={[typography.bodyStrong, styles.itemTitle]}>{item.title}</Text>
                    <Text style={[typography.caption, styles.itemText]}>{item.body}</Text>
                    <Text style={[typography.caption, styles.itemWhen]}>{formatWhen(item.createdAt)}</Text>
                  </View>
                </View>
              )}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 12, 40, 0.6)",
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: 80,
    paddingHorizontal: spacing.md,
  },
  panel: {
    width: "100%",
    maxWidth: 440,
    maxHeight: "70%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.textPrimary },
  closeButton: { color: colors.textSecondary, fontSize: 18, padding: spacing.xs },
  empty: { padding: spacing.xl },
  emptyText: { color: colors.textSecondary, textAlign: "center" },
  list: { paddingVertical: spacing.xs },
  item: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  itemUnread: { backgroundColor: colors.panelInset },
  itemIcon: { fontSize: 18, color: colors.indigo[400], width: 24, textAlign: "center", marginTop: 2 },
  warnIcon: { color: colors.terracotta[500] },
  itemBody: { flex: 1 },
  itemTitle: { color: colors.textPrimary },
  itemText: { color: colors.textSecondary, marginTop: 2 },
  itemWhen: { color: colors.textSecondary, opacity: 0.6, marginTop: 4 },
});
