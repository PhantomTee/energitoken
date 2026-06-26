import React from "react";
import Svg, { Circle } from "react-native-svg";

/**
 * A small, abstracted nod to Adinkrahene (concentric circles, symbolizing
 * leadership/greatness) — used sparingly as a single corner accent, never
 * tiled or repeated. Intentionally simplified rather than a literal symbol
 * reproduction.
 */
export function AdinkraAccent({ size = 64, color = "#2F3699", opacity = 0.12 }: { size?: number; color?: string; opacity?: number }) {
  const c = size / 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={c} cy={c} r={size * 0.48} stroke={color} strokeWidth={size * 0.045} fill="none" opacity={opacity} />
      <Circle cx={c} cy={c} r={size * 0.32} stroke={color} strokeWidth={size * 0.045} fill="none" opacity={opacity} />
      <Circle cx={c} cy={c} r={size * 0.16} fill={color} opacity={opacity} />
    </Svg>
  );
}
