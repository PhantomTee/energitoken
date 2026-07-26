import { Platform, useWindowDimensions } from "react-native";

const DESKTOP_BREAKPOINT = 900;

/** True only for web at desktop width. Multi-column/sidebar layouts should
 * gate on this, not `Platform.OS === "web"` alone -- "web" also covers
 * phone browsers, which need the same single-column layout as native. */
export function useIsDesktopWeb(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === "web" && width >= DESKTOP_BREAKPOINT;
}
