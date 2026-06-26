# EnergiToken

**IoT-based Secured Smart Energy Budgeting System with Priority Load Shedding** — a final-year engineering project.

An ESP32 + PZEM-004T V4 hardware meter measures household electricity, enforces a prepaid energy budget by shedding loads in priority order, and represents prepaid electricity credit as ERC-20 tokens (1 token = 1 watt-hour) on the **Polygon Amoy testnet**. Households can transfer surplus credit to one another, the way mobile airtime is shared.

This repository contains the three software components of the system:

| Component | What it is | Status |
|---|---|---|
| [`/contract`](contract) | ERC-20 token contract (`EnergiToken` / `ENGY`) + Hardhat deploy tooling | ✅ Deployed to Polygon Amoy |
| [`/firebase`](firebase) | Realtime Database schema, security rules, mock-data seed script | ✅ Live |
| [`/app`](app) | Expo (React Native) mobile app — login, dashboard, P2P transfer, history | 🚧 In progress |

> **Hardware note:** the physical ESP32 + PZEM-004T meter is a separate, out-of-scope deliverable. Until it's connected, the app reads mock meter data seeded into Firebase, toggleable to "live" mode in the Dashboard.

---

## Architecture

```
┌─────────────────┐        writes meter         ┌──────────────────────┐
│  ESP32 + PZEM    │ ───────readings (Wh)───────▶│ Firebase Realtime DB │
│  (out of scope)  │                              │  /meters/{wallet}     │
└─────────────────┘                              └──────────┬───────────┘
                                                              │ realtime listener
                                                              ▼
┌─────────────────┐   email OTP login,    ┌──────────────────────────────┐
│   Privy          │◀──embedded wallet────▶│   EnergiToken mobile app      │
│ (auth + wallet)  │                        │   (Expo / React Native)      │
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
                                              │  OPay payment oracle      │
                                              │  (out of scope)           │
                                              └──────────────────────────┘
```

**No backend server exists in this system.** The only off-chain service is an OPay payment oracle (out of scope for this build) that, when a payment is confirmed, calls `EnergiToken.mint(buyerWallet, wattHoursPurchased)`. The contract's `oracle`-gated `mint`/`burnConsumed` functions are the integration point — see the doc comments in [`contract/contracts/EnergiToken.sol`](contract/contracts/EnergiToken.sol).

### Why Firebase Anonymous Auth + a `uidToWallet` mapping?

Identity in this app is owned by **Privy** (email → embedded wallet), not Firebase Auth. But Firebase Realtime Database security rules need *some* `auth` object to scope access. The app bridges this by signing into Firebase **anonymously** right after a successful Privy login, then writing a write-once binding `/uidToWallet/{firebaseUid} = walletAddress`. Every other rule (`/meters/{wallet}`, `/directory/{emailKey}`) checks that the caller's `uidToWallet` entry matches the path they're trying to touch — so a session can only ever read/write its own household's data. See [`firebase/database.rules.json`](firebase/database.rules.json) and [`firebase/schema.md`](firebase/schema.md) for the exact rules and reasoning.

---

## Live deployment

- **Contract:** `EnergiToken` (ENGY) at [`0x8493324De9578BF390092ed6c4a5b1033fBF8048`](https://amoy.polygonscan.com/address/0x8493324De9578BF390092ed6c4a5b1033fBF8048) on Polygon Amoy (chain ID `80002`)
- **Oracle/deployer wallet (testnet only):** `0xDC86E1E8A5C72cce432E99483A20B19802A47ccD`
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
│   ├── database.rules.json     # security rules (anonymous-auth + uidToWallet binding)
│   └── seed.ts                 # writes one mock meter record via the Admin SDK
│
└── app/                # Expo (React Native + TypeScript) mobile app, Expo Router
    ├── app/                     # screens: login, (tabs)/dashboard, transfer, history
    └── src/
        ├── theme/               # adire indigo / laterite terracotta design system
        ├── hooks/               # useWallet, (more land as chain/Firebase wiring continues)
        ├── components/          # MetricTile, BudgetRing, RelayIndicator, etc.
        └── config/              # contract.json (generated), privy.ts, firebase.ts (gitignored)
```

---

## Getting started

### Prerequisites

- Node.js 18+
- [Expo Go](https://expo.dev/go) on a physical Android/iOS device (this project targets Expo Go, not native builds or web)
- A Polygon Amoy RPC endpoint (the public one works fine for testnet use)
- A Firebase project with Realtime Database enabled
- A [Privy](https://dashboard.privy.io) app (email login enabled)

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
npm run seed             # writes one mock meter record
```

In the Firebase console: enable **Anonymous** sign-in (Build → Authentication → Sign-in method), and publish [`database.rules.json`](firebase/database.rules.json) under the Rules tab.

### 3. Mobile app

```bash
cd app
npm install
cp .env.example .env     # fill in EXPO_PUBLIC_PRIVY_APP_ID
npx expo start
```

Scan the QR code with **Expo Go** on your phone. Pick the platform that matches your phone (Android/iOS) when scanning — this project does not support web.

You'll also need to drop a Firebase web config into `app/src/config/firebase.ts` (see `firebase/firebase.config.example.ts` for the shape) once the app starts reading live meter data.

---

## Design system

The UI draws on authentic West African visual language rather than generic fintech styling:

- **Adire indigo** (`#2F3699` family) as the primary brand color — the deep blue of hand-dyed cloth
- **Laterite terracotta** (`#B5552E` family) as the accent — the red-brown clay common across West African soil and pottery
- A single, sparse **Adinkrahene-inspired** concentric-circle motif used as a small corner accent only — never tiled, never decorative wallpaper
- High-contrast, legible typography sized for quick scanning by non-technical users

See [`app/src/theme`](app/src/theme) for the full palette, typography scale, and motif component.

---

## Build order

This project was built in nine sequential steps, each leaving the app runnable in Expo Go:

1. ✅ Scaffold the three sub-projects
2. ✅ `EnergiToken.sol` written, tested, and deployed to Polygon Amoy
3. ✅ Firebase schema, security rules, and seed script — live and verified
4. ✅ All four app screens built against mock data with the design system
5. ✅ Real Privy email-OTP login wired, with the embedded wallet auto-created on first login
6. ⬜ Swap the Dashboard's mock toggle for a real Firebase realtime listener
7. ⬜ Wire on-chain balance reads, event-log history, and the real `transfer()` call
8. ⬜ Email → wallet directory for sending credit by email
9. ⬜ Final polish: loading/error states, persisted live/mock preference, design-system pass

---

## Security notes

- All secrets (private keys, API keys, service account credentials) live in `.env` files or `serviceAccountKey.json`, all gitignored. `.env.example` files document every variable that needs to be supplied.
- The deployer/oracle wallet committed to this README is a **freshly generated, testnet-only key** with no real-world funds ever associated with it — safe to disclose for an academic demo, but not reused for anything beyond Amoy testing.
- Firebase Realtime Database denies all public access; reads/writes are scoped per-household via the anonymous-auth + `uidToWallet` binding described above.
