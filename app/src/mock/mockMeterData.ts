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
  energyWh: number;
  budgetWh: number;
  percentUsed: number;
  relays: RelayState;
  relayOverrides?: RelayOverrides;
  updatedAt: number;
};
