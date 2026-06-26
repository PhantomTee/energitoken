/**
 * Adire indigo as the primary brand color (the deep blue of hand-dyed cloth),
 * laterite terracotta as the accent (the red-brown clay common across West
 * African soil and pottery). High contrast, no gradients, no neon.
 */
export const colors = {
  indigo: {
    900: "#161A4A",
    700: "#242A7A",
    500: "#2F3699",
    300: "#5A62B8",
    100: "#E4E6F6",
  },
  terracotta: {
    700: "#7A331D",
    500: "#B5552E",
    300: "#D98A63",
    100: "#F6E4DA",
  },
  neutral: {
    black: "#15141A",
    900: "#26242E",
    700: "#4A4756",
    500: "#7A7686",
    300: "#C9C5D3",
    100: "#F2F0F6",
    white: "#FFFFFF",
  },
  success: "#3E8F5C",
  warning: "#C9962E",
  danger: "#B5302E",

  background: "#F7F5FA",
  surface: "#FFFFFF",
  textPrimary: "#15141A",
  textSecondary: "#4A4756",
  border: "#E2DFE9",
};

export type RelayTier = "r1" | "r2" | "r3" | "r4";

export const relayTierLabels: Record<RelayTier, string> = {
  r1: "Critical",
  r2: "Essential",
  r3: "Optional",
  r4: "Luxury",
};
