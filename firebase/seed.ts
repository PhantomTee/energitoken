import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Writes one mock meter record under a device ID, so the app's onboarding +
 * Dashboard flow has something real to bind to and read before the ESP32
 * meter exists. Uses the Admin SDK (service account), which bypasses
 * database.rules.json -- that's expected, since rules only govern client
 * access, not trusted server-side scripts.
 *
 * Requires a Firebase service account key. Generate one in the Firebase
 * console: Project settings -> Service accounts -> Generate new private key,
 * save it as firebase/serviceAccountKey.json (gitignored), and set
 * FIREBASE_DATABASE_URL in firebase/.env.
 */
const MOCK_DEVICE_ID = process.env.SEED_DEVICE_ID || "3B9D88";

async function main() {
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!databaseURL) {
    throw new Error("FIREBASE_DATABASE_URL is not set in firebase/.env");
  }

  initializeApp({
    credential: cert("./serviceAccountKey.json"),
    databaseURL,
  });

  const db = getDatabase();

  await db.ref(`meters/${MOCK_DEVICE_ID}`).set({
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
  });

  // The pairing API (app/api/devices/claim.ts) only accepts a device that's
  // in "pairing mode" -- normally written by the ESP32 firmware when its
  // setup button is held. Seed it here too, or onboarding can't claim this
  // mock device at all. Matches the same 1h window claim.ts enforces.
  await db.ref(`pendingDevices/${MOCK_DEVICE_ID}`).set({
    createdAt: Date.now(),
  });

  console.log(`Seeded mock meter data for device ${MOCK_DEVICE_ID}`);
  console.log(`Enter "${MOCK_DEVICE_ID}" as the device code during onboarding to bind to it (valid for 1h).`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
