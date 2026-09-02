/**
 * Adire indigo as the primary brand color (the deep blue of hand-dyed cloth),
 * laterite terracotta as the accent (the red-brown clay common across West
 * African soil and pottery). Main app screens (Dashboard, Budget, Transfer,
 * History, Settings) sit on a soft "Paper" canvas with white cards -- indigo
 * is reserved for hero moments (Splash, Login, Welcome, onboarding, the Top
 * Up backdrop), which build their own dark backgrounds directly from
 * `colors.indigo[900]` rather than these shared tokens. `panelInset` is the
 * one dark accent card per screen that should pull focus (e.g. the ENGY
 * balance card) -- navy surface, light text, the inverse of everything
 * around it.
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
  success: "#2F8F5B",
  warning: "#B4791A",
  danger: "#BA1A1A",

  // Light "Paper" theme surfaces
  background: "#FBF9F8",
  surface: "#FFFFFF",
  panelInset: "#161A4A",
  panelInsetText: "#FFFFFF",
  textPrimary: "#1B1C1C",
  textSecondary: "#5C596B",
  border: "#E4E2E1",
};

export type RelayTier = "r1" | "r2" | "r3" | "r4";

export const relayTierLabels: Record<RelayTier, string> = {
  r1: "Critical",
  r2: "Essential",
  r3: "Optional",
  r4: "Luxury",
};

/**
 * Illustrative example devices per tier, shown on Budget/RelayIndicator so
 * a household has a concrete sense of what "essential" vs "luxury" might
 * mean -- not read from any real per-household wiring data, since the app
 * has no way to know what's actually plugged into each relay. Edit these
 * if they don't match this deployment's real setup.
 *
 * Single source of truth: this used to be hardcoded separately in both
 * RelayIndicator.tsx and budget.tsx, verbatim, with no shared import --
 * editing one silently left the other stale.
 */
export const relayTierDevices: Record<RelayTier, string> = {
  r1: "Lighting, phone charging",
  r2: "Fans, some lights",
  r3: "TV, sockets",
  r4: "Water heater, AC",
};

export const relayTierThreshold: Record<RelayTier, string> = {
  r1: "Sheds at 100% used",
  r2: "Sheds at 95% used",
  r3: "Sheds at 85% used",
  r4: "Sheds at 70% used",
};
