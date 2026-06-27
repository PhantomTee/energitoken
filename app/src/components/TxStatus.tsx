import React from "react";
import { View, Text, StyleSheet, Pressable, Linking, ActivityIndicator } from "react-native";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";

export type TxState = "idle" | "pending" | "confirmed" | "failed";

const AMOY_EXPLORER_TX = "https://amoy.polygonscan.com/tx/";

export function TxStatus({ state, hash, error }: { state: TxState; hash?: string; error?: string }) {
  if (state === "idle") return null;

  return (
    <View style={styles.container}>
      {state === "pending" && (
        <View style={styles.row}>
          <ActivityIndicator color={colors.indigo[400]} />
          <Text style={[typography.bodyStrong, styles.pendingText]}>Sending transaction…</Text>
        </View>
      )}
      {state === "confirmed" && (
        <View>
          <Text style={[typography.bodyStrong, { color: colors.success }]}>Transfer confirmed</Text>
          {hash && (
            <Pressable onPress={() => Linking.openURL(`${AMOY_EXPLORER_TX}${hash}`)}>
              <Text style={[typography.dataXs, styles.link]}>{hash.slice(0, 10)}…{hash.slice(-6)} · view on PolygonScan ↗</Text>
            </Pressable>
          )}
        </View>
      )}
      {state === "failed" && (
        <Text style={[typography.bodyStrong, { color: colors.danger }]}>
          Transfer failed{error ? `: ${error}` : ""}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pendingText: { color: colors.textPrimary },
  link: { color: colors.indigo[400], marginTop: spacing.xs, textDecorationLine: "underline" },
});
