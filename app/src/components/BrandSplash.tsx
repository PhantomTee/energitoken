import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { AdinkraAccent } from "../theme/motifs/AdinkraAccent";
import { colors } from "../theme/colors";
import { typography, spacing } from "../theme/typography";

/**
 * Shown while the app is starting up (fonts loading, Privy initializing).
 * The ring pulses outward and fades — the same shape used as the logo and
 * the budget gauge, here standing in for "the household's account is
 * waking up."
 */
export function BrandSplash() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] });
  const opacity = pulse.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.5, 0.18, 0] });

  return (
    <View style={styles.screen}>
      <View style={styles.ringWrap}>
        <Animated.View style={[styles.pulseRing, { transform: [{ scale }], opacity }]}>
          <AdinkraAccent size={72} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
        </Animated.View>
        <AdinkraAccent size={72} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
      </View>
      <Text style={[typography.label, styles.wordmark]}>ENERGITOKEN</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  ringWrap: { alignItems: "center", justifyContent: "center", width: 72, height: 72 },
  pulseRing: { position: "absolute" },
  wordmark: { color: colors.terracotta[400], marginTop: spacing.lg, letterSpacing: 2 },
});
