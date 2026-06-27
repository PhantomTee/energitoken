import React from "react";
import { View, Text, StyleSheet, Pressable, Linking, ActivityIndicator } from "react-native";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";

/**
 * signing -- waiting on the Privy signature prompt, no hash yet.
 * submitted -- signed and broadcast, has a hash, waiting for confirmation.
 * confirmed/failed -- terminal states.
 */
export type TxState = "idle" | "signing" | "submitted" | "confirmed" | "failed";

const AMOY_EXPLORER_TX = "https://amoy.polygonscan.com/tx/";

function TxLink({ hash }: { hash: string }) {
  return (
    <Pressable onPress={() => Linking.openURL(`${AMOY_EXPLORER_TX}${hash}`)}>
      <Text style={[typography.dataXs, styles.link]}>
        {hash.slice(0, 10)}…{hash.slice(-6)} · view on PolygonScan ↗
      </Text>
    </Pressable>
  );
}

export function TxStatus({ state, hash, error }: { state: TxState; hash?: string; error?: string }) {
  if (state === "idle") return null;

  return (
    <View style={styles.container}>
      {state === "signing" && (
        <View style={styles.row}>
          <ActivityIndicator color={colors.indigo[400]} />
          <Text style={[typography.bodyStrong, styles.pendingText]}>Waiting for signature…</Text>
        </View>
      )}
      {state === "submitted" && (
        <View>
          <View style={styles.row}>
            <ActivityIndicator color={colors.indigo[400]} />
            <Text style={[typography.bodyStrong, styles.pendingText]}>Submitted, waiting for confirmation…</Text>
          </View>
          {hash && <TxLink hash={hash} />}
        </View>
      )}
      {state === "confirmed" && (
        <View>
          <Text style={[typography.bodyStrong, { color: colors.success }]}>Transfer confirmed</Text>
          {hash && <TxLink hash={hash} />}
        </View>
      )}
      {state === "failed" && (
        <View>
          <Text style={[typography.bodyStrong, { color: colors.danger }]}>
            Transfer failed{error ? `: ${error}` : ""}
          </Text>
          {hash && <TxLink hash={hash} />}
        </View>
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
