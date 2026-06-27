# EnergiToken

**IoT-based Secured Smart Energy Budgeting System with Priority Load Shedding** — a final-year engineering project.

An ESP32 + PZEM-004T V4 hardware meter measures household electricity, enforces a prepaid energy budget by shedding loads in priority order, and represents prepaid electricity credit as ERC-20 tokens (1 token = 1 watt-hour) on the **Polygon Amoy testnet**. Households can transfer surplus credit to one another, the way mobile airtime is shared.

This repository contains the four software components of the system:

| Component | What it is | Status |
|---|---|---|
| [`/contract`](contract) | ERC-20 token contract (`EnergiToken` / `ENGY`) + Hardhat deploy tooling | ✅ Deployed to Polygon Amoy |
| [`/firebase`](firebase) | Realtime Database schema, security rules, mock-data seed script | ✅ Live |
| [`/app`](app) | Expo Router app — login, onboarding, dashboard, P2P transfer, history, profile (mobile + web) | ✅ Functional, pending a real on-device click-through |
| [`/app/api`](app/api) | Vercel serverless functions — OPay top-up flow (create payment / webhook callback / status) | ✅ Deployed |

> **Hardware note:** the physical ESP32 + PZEM-004T meter is a separate, out-of-scope deliverable. Until it's connected, the app reads mock meter data seeded into Firebase, toggleable to "live" mode in the Dashboard. A mock device (`3B9D88`) is seeded so the device-pairing flow is testable without real hardware.

---

## Architecture

```
┌─────────────────┐        writes meter         ┌───────────────────────────┐
│  ESP32 + PZEM    │ ───────readings (Wh)───────▶│  Firebase Realtime DB     │
│  (out of scope)  │                              │  /meters/{deviceId}       │
└─────────────────┘                              │  /deviceToWallet/{id}     │
                                                   │  /walletToDevice/{wallet}│
                                                   └──────────┬────────────────┘
                                                              │ realtime listener,
                                                              │ resolved via deviceId
                                                              ▼
┌─────────────────┐   email OTP login,    ┌──────────────────────────────┐
│   Privy          │◀──embedded wallet────▶│   EnergiToken app             │
│ (auth + wallet)  │                        │   (Expo Router: mobile + web)│
└─────────────────┘                        └───────────┬──────────────────┘
                                                          │ balanceOf / transfer / events
                                                          ▼
                                              ┌──────────────────────────┐
                                              │  EnergiToken (ENGY)       │
                                              │  ERC-20, Polygon Amoy     │
                                              │  oracle-gated mint/burn   │
                                              └──────────────────────────┘
                                                          ▲
                                                          │ mint() on confirmed payment
                                                          │ burnConsumed() on meter usage
                                              ┌──────────────────────────┐
                                              │  /app/api (Vercel)        │
                                              │  OPay create-payment,     │
                                              │  webhook callback, status│
                                              └──────────────────────────┘
```

The app ships two parallel client paths to the same screens: `@privy-io/expo` for native (Android/iOS dev client) and `@privy-io/react-auth` for web, selected automatically by Metro's platform-extension resolution (`*.web.tsx` files alongside their native counterparts under `app/src/screens`). This exists because `@privy-io/expo` statically imports `react-native-webview`, which has no web implementation — see [`app/metro.config.js`](app/metro.config.js) for the resolver details that make both paths coexist in one bundle.

The only off-chain service beyond Firebase is the OPay top-up flow, now implemented as Vercel serverless functions under [`app/api`](app/api): `create-payment` starts an OPay Cashier session, `callback` is OPay's webhook that calls `mint()` once a payment is confirmed, and `status` lets the app poll a payment's state. See the doc comments in [`contract/contracts/EnergiToken.sol`](contract/contracts/EnergiToken.sol) for the contract-side `oracle`-gated `mint`/`burnConsumed` functions this calls into.

### Why Firebase Anonymous Auth + a `uidToWallet` mapping?

Identity in this app is owned by **Privy** (email → embedded wallet), not Firebase Auth. But Firebase Realtime Database security rules need *some* `auth` object to scope access. The app bridges this by signing into Firebase **anonymously** right after a successful Privy login, then writing a write-once binding `/uidToWallet/{firebaseUid} = walletAddress`. Every other rule checks that the caller's `uidToWallet` entry matches the path they're trying to touch — so a session can only ever read/write its own household's data. See [`firebase/database.rules.json`](firebase/database.rules.json) and [`firebase/schema.md`](firebase/schema.md) for the exact rules and reasoning.

### Why a device-ID pairing step, instead of keying meters by wallet?

Meters are keyed by `/meters/{deviceId}` (a 6-hex-character code derived from the ESP32's MAC address), not by wallet address. A wallet existing doesn't mean a physical meter exists yet — pairing is a real, one-time setup step a household does by typing their meter's code into the app (`app/onboarding.tsx`), mirroring how the hardware actually gets commissioned. `/deviceToWallet/{deviceId}` and `/walletToDevice/{wallet}` store both directions of that binding, write-once each, enforced both client-side (clear "already linked to another account" error) and server-side (security rules as a backstop). A wallet with no bound device is routed to onboarding instead of the Dashboard by `app/index.tsx`.

---

## Live deployment

- **Contract:** `EnergiToken` (ENGY) at [`0x8493324De9578BF390092ed6c4a5b1033fBF8048`](https://amoy.polygonscan.com/address/0x8493324De9578BF390092ed6c4a5b1033fBF8048) on Polygon Amoy (chain ID `80002`)
- **Oracle/deployer wallet (testnet only):** `0xDC86E1E8A5C72cce432E99483A20B19802A47ccD`
- **Web app + API:** [energitoken.vercel.app](https://energitoken.vercel.app) (auto-deploys from `main` via the Vercel GitHub integration)
- **Network:** Polygon Amoy testnet exclusively. **Never Mumbai** — it was shut down in 2024.

---

## Repository layout

```
energitoken/
├── contract/          # Hardhat + TypeScript — the EnergiToken ERC-20 contract
│   ├── contracts/EnergiToken.sol
│   ├── scripts/deploy.ts       # deploys + writes address/ABI into app/src/config/contract.json
│   ├── test/EnergiToken.test.ts
│   └── hardhat.config.ts       # configured for Polygon Amoy
│
├── firebase/          # Realtime Database schema, rules, and seed tooling
│   ├── schema.md               # full data model documentation
│   ├── database.rules.json     # security rules (anonymous-auth + uidToWallet + device pairing)
│   ├── firebase.json            # lets `firebase deploy --only database` target rules.json directly
│   └── seed.ts                  # seeds the mock device (3B9D88) and a meter reading via the Admin SDK
│
└── app/                # Expo Router app (TypeScript), targets mobile (dev client) + web
    ├── app/                     # routes: login, onboarding, (tabs)/{dashboard,transfer,history,profile}
    ├── api/                     # Vercel serverless functions — OPay create-payment/callback/status
    ├── eas.json                  # EAS Build profile (Android development client)
    └── src/
        ├── screens/             # RootLayout + LoginScreen, each with a .web.tsx counterpart
        ├── theme/                # dark adire-indigo/terracotta system, Space Grotesk/Inter/Space Mono
        ├── hooks/                # useWallet (+.web.tsx), useMeterData, useTransactionHistory
        ├── services/             # contract reads/writes, chain-event history, Firebase, device binding, directory
        ├── components/           # MetricTile, BudgetRing, RelayIndicator, TxStatus, CopyableField, BrandSplash, etc.
        ├── mock/                 # mock meter readings (used by the Dashboard's mock/live toggle)
        └── config/               # contract.json (generated), privy.ts, firebase.ts (gitignored)
```

---

## Getting started

### Prerequisites

- Node.js 18+
- A Polygon Amoy RPC endpoint (the public one works fine for testnet use)
- A Firebase project with Realtime Database enabled
- A [Privy](https://dashboard.privy.io) app, with **two app clients** configured (Web and Mobile) — see below
- For native builds: an [Expo](https://expo.dev) account and the EAS CLI (`npx eas-cli`)

> **Why not Expo Go?** Privy's mobile SDK (`@privy-io/expo`) depends on native modules (`react-native-passkeys`, `expo-apple-authentication`, `react-native-webview`) that classic Expo Go doesn't bundle. Native testing requires an EAS development build instead — see Step 3 below.

### 1. Smart contract

```bash
cd contract
npm install
cp .env.example .env   # fill in AMOY_RPC_URL, DEPLOYER_PRIVATE_KEY, ORACLE_ADDRESS
npm test                # run the test suite
npm run deploy:amoy     # deploy to Polygon Amoy; writes app/src/config/contract.json
```

### 2. Firebase

```bash
cd firebase
npm install
cp .env.example .env    # fill in FIREBASE_DATABASE_URL
# Place a service-account key (Firebase console → Project settings → Service accounts)
# at firebase/serviceAccountKey.json (gitignored, never commit it)
npm run seed             # seeds the mock device (3B9D88) and a meter reading
```

Publish [`database.rules.json`](firebase/database.rules.json) — either via the Firebase console's Rules tab, or non-interactively:

```bash
cd firebase
GOOGLE_APPLICATION_CREDENTIALS="$(pwd)/serviceAccountKey.json" \
  npx firebase-tools deploy --only database --project <your-project-id>
```

Also enable **Anonymous** sign-in under Build → Authentication → Sign-in method.

### 3. Mobile app — Privy setup

In the [Privy Dashboard](https://dashboard.privy.io), under your app's **Clients** settings, configure two clients:

- **Web client**: no extra config needed beyond the app ID.
- **Mobile client**: under "Allowed app identifiers" add `com.energitoken.app` (matches `app.json`'s `ios.bundleIdentifier` / `android.package`); under "Allowed app URL schemes" add `energitoken` (matches `app.json`'s `scheme`). Copy the Mobile client's **Client ID** — the native SDK needs it to know which client's allowlist to validate against (`PrivyProvider`'s `clientId` prop in [`src/screens/RootLayout.tsx`](app/src/screens/RootLayout.tsx)); without it, native requests fail with "not an allowed app identifier" even if the identifier is correctly saved.

```bash
cd app
npm install
cp .env.example .env
# fill in EXPO_PUBLIC_PRIVY_APP_ID and EXPO_PUBLIC_PRIVY_MOBILE_CLIENT_ID
```

**Web:**

```bash
npx expo start --web
```

**Native (Android dev client):**

```bash
npx eas-cli login
npx eas-cli build --platform android --profile development   # one-time per device/credentials change
npx expo start --dev-client --host lan
```

Install the build from the link EAS prints, then open it and enter the `exp://` URL Metro prints (use `--host lan` only when your phone and computer share a network — `--tunnel` otherwise, which requires `@expo/ngrok`).

---

## Design system

The UI draws on authentic West African visual language rather than a generic dark-dashboard default:

- **Canvas:** an indigo-tinted near-black (`#121022`), not a neutral charcoal — reads as "dyed cloth," not generic chrome. `panelInset` (`#EDE6DC`, "raw cotton") is the one warm, light card per screen, used for emphasis.
- **Accents:** laterite terracotta (brightened for dark backgrounds) and adire indigo — no third accent color introduced.
- **Type, three faces, one job each:** **Space Grotesk** for brand/headers, **Inter** for body copy, **Space Mono** reserved strictly for on-chain/meter data — balances, V/A/W readings, wallet addresses, tx hashes, timestamps.
- **Signature motif:** the Adinkrahene-inspired concentric-ring accent does double duty as both the literal logo mark (solid, two-tone, in every screen header) and the shape of the Dashboard's budget gauge — one shape carrying both identity and data.

See [`app/src/theme`](app/src/theme) for the full palette, typography scale, and motif component.

---

## Build order

1. ✅ Scaffold the three sub-projects
2. ✅ `EnergiToken.sol` written, tested, and deployed to Polygon Amoy
3. ✅ Firebase schema, security rules, and seed script — live and verified
4. ✅ All app screens built against mock data with the design system
5. ✅ Real Privy email-OTP login wired, with the embedded wallet auto-created on first login
6. ✅ Dashboard's mock/live toggle wired to a real Firebase realtime listener
7. ✅ On-chain balance reads, real chain-event history, and the real `transfer()` call (with pre-flight checks and full signing → submitted → confirmed/failed lifecycle UI)
8. ✅ Email → wallet directory for sending credit by email
9. ✅ Device-ID onboarding: meters keyed by paired device, not wallet, with a dedicated pairing screen
10. ✅ Web build (parallel Privy client path, see Architecture above) deployed to Vercel alongside the API
11. ✅ Dark redesign, branded splash, Profile tab, pull-to-refresh
12. ⬜ A real end-to-end click-through on a physical device — every step above has been verified by script or code review, but no one has yet tapped through email OTP → onboarding → live dashboard → transfer on the actual app

---

## Security notes

- All secrets (private keys, API keys, service account credentials) live in `.env` files or `serviceAccountKey.json`, all gitignored. `.env.example` files document every variable that needs to be supplied.
- The deployer/oracle wallet committed to this README is a **freshly generated, testnet-only key** with no real-world funds ever associated with it — safe to disclose for an academic demo, but not reused for anything beyond Amoy testing.
- Firebase Realtime Database denies all public access; reads/writes are scoped per-household via the anonymous-auth + `uidToWallet` binding, and per-meter via the device-pairing binding, both described above.
