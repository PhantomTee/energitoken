import React, { useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../src/theme/colors";
import { typography, spacing, radius } from "../src/theme/typography";
import { AdinkraAccent } from "../src/theme/motifs/AdinkraAccent";
import { markOnboardingSeen } from "../src/services/firstLaunch";

const SLIDES = [
  {
    icon: "⚡",
    title: "Track your energy in real time",
    body: "See voltage, current, power, and usage update live from your household's meter.",
  },
  {
    icon: "◐",
    title: "Budget your credit, protect what matters",
    body: "Set a budget and your meter sheds non-critical loads gently — lighting and phone charging stay on to the very end.",
  },
  {
    icon: "⇄",
    title: "Share credit with your neighbours",
    body: "Send surplus energy credit to another household by email, the same way you'd share mobile airtime.",
  },
] as const;

export default function WelcomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList>(null);
  const [index, setIndex] = useState(0);

  const isLast = index === SLIDES.length - 1;

  const finish = async () => {
    await markOnboardingSeen();
    router.replace("/login");
  };

  const goNext = () => {
    if (isLast) {
      finish();
      return;
    }
    listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
    if (newIndex !== index) setIndex(newIndex);
  };

  return (
    <View style={styles.screen}>
      {!isLast && (
        <Pressable style={styles.skipButton} onPress={finish} hitSlop={12}>
          <Text style={[typography.caption, styles.skipText]}>Skip</Text>
        </Pressable>
      )}

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(item) => item.title}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <View style={styles.iconWrap}>
              <AdinkraAccent size={64} color={colors.terracotta[400]} dotColor={colors.indigo[400]} opacity={1} />
              <Text style={styles.icon}>{item.icon}</Text>
            </View>
            <Text style={[typography.display, styles.title]}>{item.title}</Text>
            <Text style={[typography.body, styles.body]}>{item.body}</Text>
          </View>
        )}
      />

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
        <Pressable style={styles.button} onPress={goNext}>
          <Text style={[typography.bodyStrong, styles.buttonText]}>{isLast ? "Get Started" : "Next"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.indigo[900] },
  skipButton: { position: "absolute", top: spacing.xxl, right: spacing.lg, zIndex: 1, padding: spacing.sm },
  skipText: { color: colors.indigo[100], opacity: 0.85 },
  slide: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  iconWrap: { alignItems: "center", justifyContent: "center", marginBottom: spacing.xl },
  icon: { position: "absolute", fontSize: 24 },
  title: { color: colors.neutral.white, textAlign: "center", marginBottom: spacing.md },
  body: { color: colors.indigo[100], textAlign: "center", opacity: 0.85 },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.lg },
  dots: { flexDirection: "row", justifyContent: "center", gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.indigo[300], opacity: 0.4 },
  dotActive: { opacity: 1, backgroundColor: colors.terracotta[400] },
  button: {
    backgroundColor: colors.terracotta[400],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  buttonText: { color: colors.neutral.white },
});
