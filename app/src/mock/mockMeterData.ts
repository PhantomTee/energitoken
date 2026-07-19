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

/** Two canned readings so the live/mock toggle visibly changes something. */
export const mockMeterReadingA: MeterReading = {
  voltage: 231.4,
  current: 2.8,
  power: 648,
  frequency: 50.0,
  powerFactor: 0.94,
  energyWh: 4200,
  budgetWh: 15000,
  percentUsed: 28,
  relays: { r1: true, r2: true, r3: true, r4: false },
  updatedAt: Date.now(),
};

export const mockMeterReadingB: MeterReading = {
  voltage: 226.1,
  current: 5.4,
  power: 1221,
  frequency: 49.8,
  powerFactor: 0.89,
  energyWh: 12750,
  budgetWh: 15000,
  percentUsed: 85,
  relays: { r1: true, r2: true, r3: false, r4: false },
  updatedAt: Date.now(),
};

/**
 * The household's ESP32 meter identifies itself by MAC address — this is
 * what binds a physical device to a wallet during pairing. Mocked for now,
 * same as the readings above, until Step 6 wires the real Firebase record.
 */
export const mockEspMacAddress = "24:6F:28:AB:3C:91";
