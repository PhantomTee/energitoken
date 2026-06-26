export type TxDirection = "mint" | "transfer-in" | "transfer-out" | "burn";

export type TxRecord = {
  hash: string;
  direction: TxDirection;
  amountWh: number;
  counterparty: string;
  timestamp: number;
};

const now = Date.now();
const hour = 1000 * 60 * 60;

export const mockTransactions: TxRecord[] = [
  {
    hash: "0xa1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcd",
    direction: "mint",
    amountWh: 10000,
    counterparty: "Oracle (OPay top-up)",
    timestamp: now - hour * 50,
  },
  {
    hash: "0xb2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcde1",
    direction: "burn",
    amountWh: 4200,
    counterparty: "Meter consumption",
    timestamp: now - hour * 30,
  },
  {
    hash: "0xc3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcde12",
    direction: "transfer-out",
    amountWh: 1500,
    counterparty: "uche,n@gmail,com",
    timestamp: now - hour * 10,
  },
  {
    hash: "0xd4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcde123a",
    direction: "transfer-in",
    amountWh: 800,
    counterparty: "amaka,o@yahoo,com",
    timestamp: now - hour * 2,
  },
];
