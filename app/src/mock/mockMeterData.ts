export type RelayState = { r1: boolean; r2: boolean; r3: boolean; r4: boolean };

export type MeterReading = {
  voltage: number;
  current: number;
  power: number;
  energyWh: number;
  budgetWh: number;
  percentUsed: number;
  relays: RelayState;
  updatedAt: number;
};

/** Two canned readings so the live/mock toggle visibly changes something. */
export const mockMeterReadingA: MeterReading = {
  voltage: 231.4,
  current: 2.8,
  power: 648,
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
  energyWh: 12750,
  budgetWh: 15000,
  percentUsed: 85,
  relays: { r1: true, r2: true, r3: false, r4: false },
  updatedAt: Date.now(),
};
