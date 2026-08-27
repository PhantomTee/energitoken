import React, { useEffect, useRef } from "react";
import { View, Text, Animated, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { typography, spacing } from "../theme/typography";

type Props = {
  /** energyWh minus the last actual burn's checkpoint (see
   * meters/{deviceId}/lastBurnedWh, mirrored by /api/oracle/burn.ts).
   * null means no burn has ever run for this device yet -- unknown, not zero. */
  unburnedWh: number | null;
};

/** Live "has my latest consumption actually settled on-chain yet" indicator.
 * Pulses amber while there's a real gap between what the meter has reported
 * and what the oracle has actually burned; flips to a static green check the
 * moment the next hourly burn closes that gap. */
export function PendingBurnBadge({ unburnedWh }: Props) {
  const pulse = useRef(new Animated.Value(1)).current;
  const settled = unburnedWh !== null && unburnedWh < 1;

  useEffect(() => {
    if (settled) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [settled, pulse]);

  if (unburnedWh === null) return null;

  return (
    <View style={styles.row}>
      {settled ? (
        <Ionicons name="checkmark-circle" size={14} color={colors.success} />
      ) : (
        <Animated.View style={[styles.dot, { opacity: pulse }]} />
      )}
      <Text style={[typography.caption, settled ? styles.settledText : styles.pendingText]}>
        {settled ? "Settled on-chain" : `${Math.round(unburnedWh).toLocaleString()} ENGY pending settlement`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warning },
  pendingText: { color: colors.warning },
  settledText: { color: colors.success },
});
