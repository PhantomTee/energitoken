import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { typography, spacing } from "../theme/typography";
import { AdinkraAccent } from "../theme/motifs/AdinkraAccent";

/** The same light "bolt + EnergiToken + settings" bar every mobile tab
 * screen shows above its own title treatment, per the mockups -- Dashboard,
 * Budget, Transfer, and History all share this exact header, differing only
 * in what comes below it (a dark hero band, or the title straight on the
 * page background). */
export function MobileTopBar() {
  return (
    <View style={styles.row}>
      <View style={styles.brandRow}>
        <AdinkraAccent size={28} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
        <Text style={[typography.h2, styles.wordmark]}>EnergiToken</Text>
      </View>
      <Pressable onPress={() => router.push("/(tabs)/profile")} hitSlop={8} accessibilityLabel="Settings">
        <Ionicons name="settings-outline" size={20} color={colors.textPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  wordmark: { color: colors.textPrimary, letterSpacing: 0.5 },
});
