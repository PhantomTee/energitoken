import { TextStyle } from "react-native";

/**
 * One system font, weight and size carry the hierarchy — no decorative
 * display fonts. Keeps the UI legible for non-technical users at a glance.
 */
export const typography: Record<string, TextStyle> = {
  display: { fontSize: 34, fontWeight: "700", letterSpacing: -0.5 },
  h1: { fontSize: 24, fontWeight: "700" },
  h2: { fontSize: 18, fontWeight: "600" },
  body: { fontSize: 15, fontWeight: "400" },
  bodyStrong: { fontSize: 15, fontWeight: "600" },
  caption: { fontSize: 13, fontWeight: "400" },
  label: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5 },
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
