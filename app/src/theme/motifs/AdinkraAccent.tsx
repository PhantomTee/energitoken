import React from "react";
import Svg, { Circle } from "react-native-svg";

/**
 * A small, abstracted nod to Adinkrahene (concentric circles, symbolizing
 * leadership/greatness). Two jobs, one shape:
 * - decorative corner accent (low opacity, single color) — the original use
 * - the literal brand mark in header bars (full opacity, two-tone) — pass
 *   `dotColor` to split the rings from the center dot
 * The same proportions also drive BudgetRing, so the logo and the budget
 * gauge read as the same family of shape.
 */
export function AdinkraAccent({
  size = 64,
  color = "#2F3699",
  dotColor,
  opacity = 0.12,
}: {
  size?: number;
  color?: string;
  dotColor?: string;
  opacity?: number;
}) {
  const c = size / 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={c} cy={c} r={size * 0.48} stroke={color} strokeWidth={size * 0.09} fill="none" opacity={opacity} />
      <Circle cx={c} cy={c} r={size * 0.3} stroke={color} strokeWidth={size * 0.09} fill="none" opacity={opacity} />
      <Circle cx={c} cy={c} r={size * 0.12} fill={dotColor ?? color} opacity={opacity} />
    </Svg>
  );
}
