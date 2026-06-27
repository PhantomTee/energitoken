/**
 * Adire indigo as the primary brand color (the deep blue of hand-dyed cloth),
 * laterite terracotta as the accent (the red-brown clay common across West
 * African soil and pottery). The canvas is dark — an indigo-tinted near-black
 * rather than a neutral charcoal, so it still reads as "dyed cloth" rather
 * than generic dashboard chrome. `panelInset` is the one warm, light surface
 * in the system: raw, undyed cotton before it meets the indigo vat — used
 * sparingly, for the one card per screen that should pull focus.
 */
export const colors = {
  indigo: {
    900: "#161A4A",
    700: "#242A7A",
    500: "#2F3699",
    400: "#6F77D6",
    300: "#5A62B8",
    100: "#E4E6F6",
  },
  terracotta: {
    700: "#7A331D",
    500: "#B5552E",
    400: "#C2643A",
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
  success: "#4FB377",
  warning: "#D9A53E",
  danger: "#D1453F",

  // Dark theme surfaces
  background: "#121022",
  surface: "#1B1830",
  panelInset: "#EDE6DC",
  panelInsetText: "#161A4A",
  textPrimary: "#F3EFE6",
  textSecondary: "#9590B0",
  border: "#322C54",
};

export type RelayTier = "r1" | "r2" | "r3" | "r4";

export const relayTierLabels: Record<RelayTier, string> = {
  r1: "Critical",
  r2: "Essential",
  r3: "Optional",
  r4: "Luxury",
};
