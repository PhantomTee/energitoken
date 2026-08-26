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

/**
 * How much of a household's spendable balance is actually free to send
 * elsewhere, once today's remaining budget allowance is set aside.
 * "Budgeted" deliberately means only today's remaining daily slice
 * (budgetWh - cycleWh), not the whole multi-day plan a household picked on
 * the Budget page -- the meter only ever enforces the daily figure, so
 * reserving future days would restrict sharing further than anything else
 * in the system actually commits to. No budget set at all (budgetWh/cycleWh
 * null, the default until a household opts in) reserves nothing.
 */
export function getUnbudgetedWh(
  spendableWh: bigint,
  budgetWh: number | null,
  cycleWh: number | null
): bigint {
  if (budgetWh == null || cycleWh == null) return spendableWh;
  const remainingWh = Math.max(0, Math.round(budgetWh - cycleWh));
  const reserved = BigInt(remainingWh);
  return reserved >= spendableWh ? 0n : spendableWh - reserved;
}
