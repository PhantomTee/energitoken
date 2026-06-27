import { TextStyle } from "react-native";

/**
 * Three faces, each with one job:
 * - Space Grotesk carries the brand voice (headers, labels) — geometric,
 *   ties to the ring motif used as the logo mark.
 * - Inter carries the household's voice (body copy, instructions) — plain
 *   and legible for non-technical readers at a glance.
 * - Space Mono carries the ledger's truth — it's used only for numbers that
 *   come off the chain or the meter: balances, V/A/W readings, addresses,
 *   tx hashes, timestamps. Never used for prose.
 */
export const fonts = {
  display: "SpaceGrotesk_700Bold",
  displayMedium: "SpaceGrotesk_500Medium",
  body: "Inter_400Regular",
  bodyStrong: "Inter_600SemiBold",
  mono: "SpaceMono_400Regular",
  monoBold: "SpaceMono_700Bold",
};

export const typography: Record<string, TextStyle> = {
  display: { fontFamily: fonts.display, fontSize: 34, letterSpacing: -0.5 },
  h1: { fontFamily: fonts.display, fontSize: 24 },
  h2: { fontFamily: fonts.displayMedium, fontSize: 18 },
  body: { fontFamily: fonts.body, fontSize: 15 },
  bodyStrong: { fontFamily: fonts.bodyStrong, fontSize: 15 },
  caption: { fontFamily: fonts.body, fontSize: 13 },
  label: { fontFamily: fonts.displayMedium, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" },
  // Data/mono — balances, meter readings, addresses, hashes, timestamps.
  data: { fontFamily: fonts.monoBold, fontSize: 34, letterSpacing: -0.5 },
  dataMd: { fontFamily: fonts.monoBold, fontSize: 22 },
  dataSm: { fontFamily: fonts.mono, fontSize: 15 },
  dataXs: { fontFamily: fonts.mono, fontSize: 12 },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
};
