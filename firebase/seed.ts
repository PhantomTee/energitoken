import * as admin from "firebase-admin";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Writes one mock meter record so the app's Dashboard has live-shaped data to
 * read before the ESP32 meter is connected. Uses the Admin SDK (service
 * account), which bypasses database.rules.json — that's expected, since rules
 * only govern client access, not trusted server-side scripts.
 *
 * Requires a Firebase service account key. Generate one in the Firebase
 * console: Project settings -> Service accounts -> Generate new private key,
 * save it as firebase/serviceAccountKey.json (gitignored), and set
 * FIREBASE_DATABASE_URL in firebase/.env.
 */
const MOCK_WALLET = process.env.SEED_WALLET_ADDRESS || "0xDC86E1E8A5C72cce432E99483A20B19802A47ccD";

async function main() {
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!databaseURL) {
    throw new Error("FIREBASE_DATABASE_URL is not set in firebase/.env");
  }

  admin.initializeApp({
    credential: admin.credential.cert("./serviceAccountKey.json"),
    databaseURL,
  });

  const db = admin.database();

  await db.ref(`meters/${MOCK_WALLET}`).set({
    voltage: 231.4,
    current: 2.8,
    power: 648,
    energyWh: 4200,
    budgetWh: 15000,
    percentUsed: 28,
    relays: { r1: true, r2: true, r3: true, r4: false },
    updatedAt: Date.now(),
  });

  console.log(`Seeded mock meter data for ${MOCK_WALLET}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
