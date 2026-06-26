# EnergiToken

IoT-based Secured Smart Energy Budgeting System with Priority Load Shedding — a final-year engineering project.

An ESP32 + PZEM-004T V4 hardware meter measures household electricity, enforces a prepaid energy budget by shedding loads in priority order, and represents prepaid electricity credit as ERC-20 tokens (1 token = 1 watt-hour) on the Polygon Amoy testnet. Households can transfer surplus credit to one another, the way mobile airtime is shared.

## Sub-projects

- **`/contract`** — Hardhat + TypeScript project containing the `EnergiToken` ERC-20 contract (0 decimals, oracle-gated mint/burn) and its deploy script, targeting Polygon Amoy (chainId 80002).
- **`/firebase`** — Firebase Realtime Database schema, security rules, and a seed script for mock meter data, used until the physical ESP32 meter is connected.
- **`/app`** — Expo (React Native + TypeScript) mobile app with Privy email-login + embedded wallet, a live dashboard, peer-to-peer credit transfer, and on-chain transaction history.

## Architecture notes

- **No backend server exists in this system.** The only off-chain component is an OPay payment oracle (out of scope for this build) that, when a payment is confirmed, calls `EnergiToken.mint(buyerWallet, wattHoursPurchased)`. The contract's `oracle`-gated `mint`/`burnConsumed` functions are the integration point — see the doc comments in [`contract/contracts/EnergiToken.sol`](contract/contracts/EnergiToken.sol).
- **Auth**: Privy handles wallet identity (email magic-link → embedded wallet). The app separately signs into Firebase Anonymous Auth and binds that session to the wallet address via a write-once `/uidToWallet` mapping, which Firebase security rules use to scope `/meters/{wallet}` access to its owner. See [`firebase/schema.md`](firebase/schema.md).
- **Network**: Polygon Amoy testnet only (chainId 80002). No real money, no app store deployment — runs through Expo Go.

## Build order

Followed in nine steps from contract → Firebase → app UI (mock data) → Privy → Firebase live → chain reads/writes → email directory → polish. See the project plan for full detail.
