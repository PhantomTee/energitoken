export type RelayState = { r1: boolean; r2: boolean; r3: boolean; r4: boolean };

/**
 * Manual override per relay tier, set by the user from the Dashboard/Budget
 * screen. `true`/`false` forces the relay on/off regardless of the budget
 * algorithm; an absent key (or explicit `null`) means "auto" -- the ESP32's
 * own priority-shedding logic decides. Firmware is expected to check this
 * node before applying its automatic decision for that tier.
 */
export type RelayOverrides = Partial<Record<keyof RelayState, boolean>>;

export type MeterReading = {
  voltage: number;
  current: number;
  power: number;
  /** Optional -- absent on live readings until firmware sends it (PZEM-004T
   * reports both directly, but the field simply won't exist on Firebase
   * writes from older/incomplete firmware). Always guard with `!= null`. */
  frequency?: number;
  powerFactor?: number;
  /** Watt-hours consumed in the CURRENT budget cycle only -- reset by the
   * meter at every cycle roll. This is what the budget maths is built on
   * (percentUsed, "used this cycle", getUnbudgetedWh). It is deliberately
   * NOT the figure the burn oracle settles against; see energyTotalWh. */
  energyWh: number;
  /** Watt-hours on the meter's lifetime cumulative register, which only
   * goes backwards if the PZEM module is reset or replaced. Optional: absent
   * until the device runs firmware from 2026-08-31 or later, and absent on a
   * board that has not completed a sensor read since boot. This is the scale
   * lastBurnedWh is expressed in, so "consumed but not yet settled" is
   * energyTotalWh - lastBurnedWh -- never energyWh, which resets daily and
   * would make that difference meaningless after the first midnight. */
  energyTotalWh?: number;
  budgetWh: number;
  percentUsed: number;
  relays: RelayState;
  relayOverrides?: RelayOverrides;
  updatedAt: number;
  /** Unix ms when the meter's current budget cycle began -- absent until a
   * budget has been set at least once. Written atomically with budgetWh on
   * set/reset, and rewritten whenever the meter itself rolls a new cycle
   * (local midnight via NTP, or the 25h no-signal fallback -- see
   * startNewCycle() in the firmware). A cycle is nominally one day. */
  cycleStartedAt?: number;
  /** Watt-hours as of the last actual on-chain burn -- absent until the
   * oracle has burned for this device at least once. energyWh minus this is
   * "consumed but not yet settled," the figure the Dashboard's pending/
   * settled badge is built on. */
  lastBurnedWh?: number;
};
