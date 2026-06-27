import React from "react";
import { View, Text, StyleSheet, FlatList, Pressable, Linking } from "react-native";
import { colors } from "../../src/theme/colors";
import { typography, fonts, spacing, radius } from "../../src/theme/typography";
import { mockTransactions, TxRecord, TxDirection } from "../../src/mock/mockTransactions";
import { AdinkraAccent } from "../../src/theme/motifs/AdinkraAccent";

const AMOY_EXPLORER_TX = "https://amoy.polygonscan.com/tx/";

const DIRECTION_META: Record<TxDirection, { label: string; symbol: string; color: string }> = {
  mint: { label: "Purchased", symbol: "+", color: colors.success },
  "transfer-in": { label: "Received", symbol: "+", color: colors.success },
  "transfer-out": { label: "Sent", symbol: "−", color: colors.terracotta[400] },
  burn: { label: "Consumed", symbol: "−", color: colors.textSecondary },
};

function formatTimestamp(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function TransactionRow({ tx }: { tx: TxRecord }) {
  const meta = DIRECTION_META[tx.direction];
  return (
    <View style={styles.row}>
      <View style={[styles.symbolBadge, { backgroundColor: meta.color }]}>
        <Text style={styles.symbolText}>{meta.symbol}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={[typography.bodyStrong, styles.rowTitle]}>{meta.label}</Text>
        <Text style={[typography.caption, styles.rowCounterparty]}>{tx.counterparty}</Text>
        <Pressable onPress={() => Linking.openURL(`${AMOY_EXPLORER_TX}${tx.hash}`)}>
          <Text style={[typography.dataXs, styles.rowLink]}>{tx.hash.slice(0, 10)}…{tx.hash.slice(-6)} ↗</Text>
        </Pressable>
      </View>
      <View style={styles.rowRight}>
        <Text style={[typography.dataSm, { color: meta.color }]}>
          {meta.symbol}{tx.amountWh.toLocaleString()} Wh
        </Text>
        <Text style={[typography.dataXs, styles.rowTime]}>{formatTimestamp(tx.timestamp)}</Text>
      </View>
    </View>
  );
}

/** Mock-only for now (build Step 4). Step 7 swaps this for real on-chain event logs. */
export default function HistoryScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={[typography.h1, styles.headerTitle]}>History</Text>
        <AdinkraAccent size={28} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
      </View>
      <FlatList
        data={mockTransactions}
        keyExtractor={(item) => item.hash}
        renderItem={({ item }) => <TransactionRow tx={item} />}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerTitle: { color: colors.textPrimary },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md },
  symbolBadge: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  symbolText: { color: colors.neutral.white, fontFamily: fonts.monoBold, fontSize: 16 },
  rowBody: { flex: 1, marginLeft: spacing.md },
  rowTitle: { color: colors.textPrimary },
  rowCounterparty: { color: colors.textSecondary, marginTop: 2 },
  rowLink: { color: colors.indigo[400], marginTop: 2 },
  rowRight: { alignItems: "flex-end" },
  rowTime: { color: colors.textSecondary, marginTop: 2 },
  separator: { height: 1, backgroundColor: colors.border },
});
