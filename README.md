# EnergiToken

**IoT-based Secured Smart Energy Budgeting System with Priority Load Shedding** — a final-year engineering project.

An ESP32 + PZEM-004T V4 hardware meter measures household electricity, enforces a prepaid energy budget by shedding loads in priority order, and represents prepaid electricity credit as ERC-20 tokens (1 token = 1 watt-hour) on the **Polygon Amoy testnet**. Households can transfer surplus credit to one another, the way mobile airtime is shared.

This repository contains the four software components of the system:

| Component | What it is | Status |
|---|---|---|
| [`/contract`](contract) | ERC-20 token contract (`EnergiToken` / `ENGY`) + Hardhat deploy tooling | ✅ Deployed to Polygon Amoy |
| [`/firebase`](firebase) | Realtime Database schema, security rules, mock-data seed script | ✅ Live |
| [`/app`](app) | Expo Router app — login, onboarding, dashboard, budget, P2P transfer, history, profile (mobile + web) | ✅ Functional, verified end to end against real hardware |
| [`/app/api`](app/api) | Vercel serverless functions — Flutterwave top-up flow, consumption oracle, device pairing, meter reset | ✅ Deployed |
| [`/firmware`](firmware/esp32) | ESP32 + PZEM-004T meter firmware — budgeting, priority load shedding, HMAC-signed consumption reports | ✅ Flashed and running on real hardware |

> **Hardware:** two physical ESP32 + PZEM-004T meters are flashed and running against the live backend. The two boards have opposite relay-module polarity (documented per-board in the firmware's `RELAY_CLOSED`/`RELAY_OPEN` constants) -- confirm on the actual hardware before flashing a third. `firebase/seed.ts` can still seed a mock device if you want to test the app without hardware on hand.

---

## Architecture

```
┌─────────────────┐   HMAC-signed        ┌───────────────────────────┐
│  ESP32 + PZEM    │ ──meter readings────▶│  Firebase Realtime DB     │
│  (real hardware) │   (legacy DB secret) │  /meters/{deviceId}       │
└─────────────────┘                       │  /deviceToWallet/{id}     │
                                            │  /walletToDevice/{wallet}│
                                            └──────────┬────────────────┘
                                                        │ read/write only via
                                                        │ the Admin SDK, server-side
                                                        ▼
┌─────────────────┐   email OTP login,    ┌──────────────────────────────┐
│   Privy          │◀──embedded wallet────▶│   EnergiToken app             │
│ (auth + wallet)  │                        │   (Expo Router: mobile + web)│
└─────────────────┘                        └───────────┬──────────────────┘
                                          wallet signs a message,          │
                                          trades it for a session token ───┤
                                          (app/api/session/create.ts) ─────┤
                                                        │ bearer-token calls to
                                                        │ /app/api, ~4s poll
                                                        │ (no direct client<->Firebase)
                                                        ▼         │ balanceOf / transfer / events
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
                                              │  Flutterwave checkout,    │
                                              │  webhook, consumption     │
                                              │  oracle (GitHub Actions)  │
                                              └──────────────────────────┘
```

The app ships two parallel client paths to the same screens: `@privy-io/expo` for native (Android/iOS dev client) and `@privy-io/react-auth` for web, selected automatically by Metro's platform-extension resolution (`*.web.tsx` files alongside their native counterparts under `app/src/screens`). This exists because `@privy-io/expo` statically imports `react-native-webview`, which has no web implementation — see [`app/metro.config.js`](app/metro.config.js) for the resolver details that make both paths coexist in one bundle.

The only off-chain service beyond Firebase is the top-up flow, implemented as Vercel serverless functions under [`app/api`](app/api): `payments/create.ts` starts a Flutterwave hosted-checkout session, `payments/callback.ts` is Flutterwave's webhook (independently re-verified against Flutterwave's own API before minting anything, not trusted from the webhook body alone) that calls `mint()` once a payment is confirmed, and `payments/status.ts` lets the app poll a payment's state. A separate consumption oracle (`api/oracle/{set-pending,burn,cycle-tick}.ts`, cron'd via `.github/workflows/burn-oracle.yml`) turns meter readings into token burns and rolls each meter's daily budget cycle. See the doc comments in [`contract/contracts/EnergiToken.sol`](contract/contracts/EnergiToken.sol) for the contract-side `oracle`-gated `mint`/`burnConsumed`/`setPendingBurn` functions these call into.

### Why does the app never talk to Firebase directly?

Earlier versions of this app signed into Firebase Anonymous Auth on every screen mount and used that ID token as its credential for reads/writes, gated by a `uidToWallet` binding. That broke real login on networks that block Firebase's own auth endpoint (school/campus WiFi, some ISPs) -- see [`app/src/services/firebaseSession.ts`](app/src/services/firebaseSession.ts) for the full history. The app now never authenticates to Firebase as a client at all: it signs a message proving wallet ownership, trades that for the app's own session token via `/api/session/create`, and presents that token as a bearer credential to every other `/api` endpoint -- which do the actual Firebase reads/writes server-side via the Admin SDK. `firebase/database.rules.json` still encodes a real per-household ACL (kept in sync with what's live in the Firebase console) as defense-in-depth if a client path is ever reintroduced, but for current traffic the Admin SDK bypasses it entirely, same as the ESP32 meters' legacy database secret.

### Why a device-ID pairing step, instead of keying meters by wallet?

Meters are keyed by `/meters/{deviceId}` (a 6-hex-character code derived from the ESP32's MAC address), not by wallet address. A wallet existing doesn't mean a physical meter exists yet — pairing is a real, one-time setup step a household does by typing their meter's code into the app (`app/onboarding.tsx`), mirroring how the hardware actually gets commissioned. `/deviceToWallet/{deviceId}` and `/walletToDevice/{wallet}` store both directions of that binding, write-once each, enforced both client-side (clear "already linked to another account" error) and server-side (security rules as a backstop). A wallet with no bound device is routed to onboarding instead of the Dashboard by `app/index.tsx`.

---

## Live deployment

- **Contract:** `EnergiToken` (ENGY) at [`0xC1583007087F596f37396E38D949C3EacfaC58c5`](https://amoy.polygonscan.com/address/0xC1583007087F596f37396E38D949C3EacfaC58c5) on Polygon Amoy (chain ID `80002`) — redeployed to add the on-chain `pendingBurn`/spendable-balance guard (double-spend fix, see Security notes below)
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
│   ├── database.rules.json     # per-household ACL, kept in sync with what's live -- see
│   │                            # "Why does the app never talk to Firebase directly?" above
│   ├── firebase.json            # lets `firebase deploy --only database` target rules.json directly
│   └── seed.ts                  # seeds a mock device + meter reading via the Admin SDK, for testing without hardware
│
├── firmware/esp32/energitoken_meter/  # ESP32 + PZEM-004T meter firmware (Arduino), real HMAC key
│                                        # redacted before commit -- see the file's own header comment
│
└── app/                # Expo Router app (TypeScript), targets mobile (dev client) + web
    ├── app/                     # routes: login, onboarding, (tabs)/{dashboard,budget,transfer,history,profile}
    ├── api/                     # Vercel serverless functions -- data.ts (meters/notifications/directory),
    │                            # devices.ts (pairing), payments/* (Flutterwave), oracle/* (consumption/cycle),
    │                            # session/create.ts (wallet-signature session tokens), tariff.ts
    ├── eas.json                  # EAS Build profiles (development/preview/production)
    └── src/
        ├── screens/             # RootLayout + LoginScreen, each with a .web.tsx counterpart
        ├── theme/                # dark adire-indigo/terracotta system, Space Grotesk/Inter/Space Mono
        ├── hooks/                # useWallet (+.web.tsx), useMeterData, useTransactionHistory, useNotifications
        ├── services/             # contract reads/writes, chain-event history, session/auth, device binding, directory
        ├── components/           # MetricTile, BudgetRing, RelayIndicator, TxStatus, CopyableField, BrandSplash, etc.
        └── config/               # contract.json (generated), privy.ts
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
npm run seed             # optional -- seeds a mock device and a meter reading, for testing without real hardware
```

Publish [`database.rules.json`](firebase/database.rules.json) — either via the Firebase console's Rules tab, or non-interactively:

```bash
cd firebase
GOOGLE_APPLICATION_CREDENTIALS="$(pwd)/serviceAccountKey.json" \
  npx firebase-tools deploy --only database --project <your-project-id>
```

The app itself never authenticates to Firebase as a client (see "Why does the app never talk to Firebase directly?" above), so no Firebase Auth sign-in method needs to be enabled -- only the Realtime Database.

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
6. ✅ Dashboard wired to real meter data, polled from `/api/data` (server-side Firebase Admin SDK, no client Firebase Auth)
7. ✅ On-chain balance reads, real chain-event history, and the real `transfer()` call (with pre-flight checks and full signing → submitted → confirmed/failed lifecycle UI)
8. ✅ Email → wallet directory for sending credit by email
9. ✅ Device-ID onboarding: meters keyed by paired device, not wallet, with a dedicated pairing screen
10. ✅ Web build (parallel Privy client path, see Architecture above) deployed to Vercel alongside the API
11. ✅ Dark redesign, branded splash, Profile tab, pull-to-refresh
12. ✅ Budget screen: duration-based daily allowance, live "cycle started X ago, resets in ~Y" indicator, Reset Budget (clears budget, overrides, and restores every relay)
13. ✅ Real ESP32 + PZEM-004T firmware flashed onto two physical boards and running against the live backend end to end -- login → pairing → live budget enforcement → priority load shedding → a real transfer, all confirmed on real hardware, not just script/code review

---

## Security notes

- All secrets (private keys, API keys, service account credentials) live in `.env` files or `serviceAccountKey.json`, all gitignored. `.env.example` files document every variable that needs to be supplied.
- The deployer/oracle wallet committed to this README is a **freshly generated, testnet-only key** with no real-world funds ever associated with it — safe to disclose for an academic demo, but not reused for anything beyond Amoy testing.
- Firebase Realtime Database denies all public client access; the app only ever reaches it through this project's own `/api` endpoints, which use the Admin SDK and bypass `database.rules.json` by design (the ESP32 meters bypass it too, via their own legacy database secret). `database.rules.json` still encodes a real per-household ACL as defense-in-depth for if a client path is ever reintroduced.
- Wallet identity is proven by a signed message, not trusted from a request body: `app/api/session/create.ts` recovers the signer from a signature over `buildSessionMessage()` and checks it matches the claimed wallet address before issuing this app's own session token (see "Why does the app never talk to Firebase directly?" above). `app/api/devices.ts`'s `claim`/`unbind` actions derive the caller's wallet the same way.
- Each meter's `energyWh` is additionally signed with a per-device HMAC key (`app/api/_lib/meterHmac.ts`), derived server-side from one master secret and baked into that device's firmware at flash time. The shared legacy database secret alone can't forge a reading the oracle will actually burn tokens against -- see the doc comment at the top of that file.
- `transfer()` on `EnergiToken.sol` enforces a spendable balance (`balanceOf - pendingBurn`) on-chain, not just in the app — a household can't transfer away ENGY that represents electricity already consumed but not yet burned/settled. The oracle keeps `pendingBurn` current via a GitHub Actions cron (`.github/workflows/burn-oracle.yml`), which every job in the workflow now runs unconditionally on any firing (GitHub's own schedule delivery is unreliable enough that gating jobs to one specific cron expression left most firings doing nothing).
