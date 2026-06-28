/**
 * The contract keeps 1 ENGY token = 1 Wh (do not change this -- it's the
 * on-chain basis). Everywhere in the UI, "units" means kWh: 1 unit = 1,000 Wh
 * = 1,000 ENGY tokens. Centralized here so every screen converts the same way
 * instead of each one inlining its own ×1000/÷1000.
 */
export const WH_PER_UNIT = 1000;

export function whToUnits(wh: number): number {
  return wh / WH_PER_UNIT;
}

export function unitsToWh(units: number): number {
  return Math.round(units * WH_PER_UNIT);
}

export function tokensToUnits(tokens: bigint): number {
  return Number(tokens) / WH_PER_UNIT;
}
