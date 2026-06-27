import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import * as Clipboard from "expo-clipboard";
import { colors } from "../theme/colors";
import { typography, spacing, radius } from "../theme/typography";

/**
 * A labeled value with a tap-to-copy affordance. Used on the profile screen
 * for anything a household might need to hand to someone else verbatim —
 * email, wallet address, meter MAC — where retyping it correctly by hand
 * isn't realistic.
 */
export function CopyableField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View style={styles.field}>
      <Text style={[typography.label, styles.label]}>{label}</Text>
      <View style={styles.row}>
        <Text style={[mono ? typography.dataSm : typography.body, styles.value]} numberOfLines={1}>
          {value}
        </Text>
        <Pressable onPress={handleCopy} style={[styles.copyButton, copied && styles.copyButtonActive]}>
          <Text style={[typography.label, styles.copyText, copied && styles.copyTextActive]}>
            {copied ? "Copied" : "Copy"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { color: colors.textSecondary, marginBottom: spacing.xs },
  row: { flexDirection: "row", alignItems: "center" },
  value: { color: colors.textPrimary, flex: 1, marginRight: spacing.md },
  copyButton: {
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  copyButtonActive: { backgroundColor: colors.success, borderColor: colors.success },
  copyText: { color: colors.textPrimary },
  copyTextActive: { color: colors.neutral.white },
});
