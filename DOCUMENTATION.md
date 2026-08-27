# EnergiToken

This is my final-year engineering project, and this document is my attempt to write down everything about it in one place: why I built it, how every piece works, and where things actually stand right now rather than where I'd like them to stand.

The short version, if you only read one paragraph: EnergiToken is a prepaid electricity system for Nigerian households. A physical meter (ESP32 plus a PZEM-004T sensor) measures real power draw, a smart contract on Polygon represents the household's remaining electricity credit as an ERC-20 token, and a mobile and web app lets people top up that credit with real money, watch their usage in real time, and send surplus credit to a neighbour the same way people share mobile airtime. When a household is close to running out, the meter itself starts shedding non-critical loads in a priority order instead of just cutting the power entirely.

## Why I built this

Prepaid electricity in Nigeria already exists in the form of the token meters most households have, where you buy a voucher and type a 20-digit code into the meter. That system works, but it has no concept of priority. When the credit runs out, everything goes off at once, the freezer included, and there's no way to share leftover credit with a relative next door who's run dry before the end of the month. I wanted to build something that keeps the good part of prepaid electricity (you only pay for what you plan to use, and overspending is structurally impossible) while fixing those two gaps: graceful degradation instead of a hard cutoff, and peer-to-peer sharing instead of every household being its own island.

Putting the credit on a blockchain wasn't a requirement from day one. It became the obvious answer once I decided households needed to transfer credit to each other directly, without a bank account or a middleman clearing the transaction. An ERC-20 token where 1 token equals 1 watt-hour turns "send my neighbour some electricity" into an ordinary wallet-to-wallet transfer.

## The four pieces, and how they talk to each other

The repository is split into four parts that map to four different concerns: the smart contract, the Firebase backend, the app, and a small set of serverless API functions that sit between them.

The contract lives on Polygon's Amoy testnet and only knows about token balances. It doesn't know what a meter is, it doesn't know about Naira or Flutterwave, and it doesn't know who owns which wallet in the real world. Its entire job is minting tokens when a payment is confirmed, burning tokens when the meter reports consumption, and letting people transfer tokens to each other.

Firebase Realtime Database is the layer that actually knows about physical meters. It stores live voltage, current, and power readings, which relay is on or off, what budget a household has set, and the pairing between a wallet address and a physical device.

The app is what a household actually opens on their phone or in a browser. It's built with Expo Router, so the same codebase produces both the native Android and iOS experience and the web version at energitoken.vercel.app, with a handful of files that diverge between the two where the underlying platform APIs are genuinely different.

The API functions, deployed as Vercel serverless functions, are the glue. They handle the Flutterwave payment webhook, they run the consumption oracle that turns meter readings into token burns, and, as of the most recent security pass, they're also where wallet identity actually gets verified rather than trusted.

Here's the flow in words: a household tops up through the app, which hands off to Flutterwave's hosted checkout. Flutterwave calls back a webhook once the payment clears, the webhook mints tokens to the household's wallet, and the app's Dashboard updates because it's listening to that wallet's balance directly on-chain. Separately, the physical meter is measuring real consumption and writing it to Firebase every few seconds. A scheduled job reads that consumption and burns the matching amount of tokens from the household's balance, and the meter itself reads back the remaining budget from Firebase to decide which relays to keep energized.

## The smart contract

EnergiToken.sol is intentionally small. It's a standard OpenZeppelin ERC20 with zero decimals, because fractional watt-hours don't mean anything here, plus an `oracle` address that's the only account allowed to mint or burn. In production that oracle is a server-held private key, not a person.

Two functions do the real work: `mint(address to, uint256 wh)` runs after a confirmed payment, and `burnConsumed(address from, uint256 wh)` runs after the meter reports usage. Both are gated by a modifier that just checks `msg.sender == oracle`.

The interesting part I added later in the project is `pendingBurn`. Here's the problem it solves: a household uses electricity continuously, but burns only happen in batches (an oracle job runs every so often, not on every single watt-hour). In the gap between "electricity actually used" and "tokens actually burned," the household's on-chain balance is technically higher than what they've really got left. Without a fix, someone could watch their meter tick down, then quickly transfer their full on-chain balance to a friend right before the burn catches up, and effectively get free electricity. It's the same idea as a bank's posted balance versus available balance: a card swipe drops your available balance immediately even though the transaction hasn't settled.

`pendingBurn[address]` tracks how much a household has used but not yet had burned. The oracle updates it every five minutes with `setPendingBurn`, and the contract's transfer logic (I override OpenZeppelin v5's `_update` hook) checks that a transfer never leaves the sender with less than their pending amount. There's a public `spendableBalanceOf` view that just returns balance minus pending, which is the number the app actually shows and lets people send. I wrote Hardhat tests specifically for the case where someone tries to bypass the app entirely and call `transfer()` straight from Polygonscan's Write tab, because an app-side check alone would have been worthless against that.

The contract is currently deployed at `0xC1583007087F596f37396E38D949C3EacfaC58c5` on Amoy (chain ID 80002). There's an earlier address in the git history from before the `pendingBurn` fix; that one's superseded now.

## Firebase: the data model

`/meters/{deviceId}` is the heart of it. Each entry has voltage, current, power, frequency, power factor, cumulative energy for the current budget period, the household's budget in watt-hours, percent used, the state of all four relays, and any manual overrides a household has set from the app. The device ID itself is just the last six hex characters of the meter's MAC address, printed on the meter's screen during setup so a household can type it into the app.

Pairing a wallet to a device is a separate write-once mapping in both directions, `/deviceToWallet` and `/walletToDevice`, so a device can only ever belong to one household and a household can only ever have one device. `/directory` maps a login email to a wallet address so the Transfer screen can resolve "send to someone@example.com" into an actual address, and `/uidToWallet` is the piece that took the most rework, so it gets its own section below.

Access control used to be enforced by Firebase's security rules directly against client requests. It isn't any more, in the way that mattered most: the app doesn't talk to Firebase as a client at all now (see "The backend" and "Getting the security right" below for why) -- every read and write goes through this project's own `/api` endpoints, which use the Admin SDK and bypass `database.rules.json` regardless of what it says, the same way the meter's own database secret does. `database.rules.json` still encodes a real per-household ACL, kept in sync with what's actually live in the Firebase console, as defense-in-depth for if a client path is ever reintroduced -- it's just not what's actually gating anything right now.

## The app, screen by screen

Login is an email address and a one-time code, handled by Privy, which also creates an embedded wallet behind the scenes so nobody has to think about seed phrases. There are separate native and web implementations because Privy's mobile SDK depends on native modules that don't exist in a browser, but functionally they do the same thing, down to a "use a different email" back option on both.

First-time users land on a device pairing screen after logging in. They either scan a QR code or type the six-character code from their meter's screen, and the app hands that off to a server endpoint that checks the meter is actually in pairing mode before it locks in the binding.

The Dashboard is what people see most. It shows live voltage, current, and power in a small grid, a ring showing percent of budget used, the current state of all four relays, and the wallet's ENGY balance. Once I added the spendable-balance concept, the balance card also shows the raw on-chain figure next to what's actually available to send, with a short line explaining that the gap is electricity already used but not yet settled on-chain.

Budget works on a duration model rather than a flat daily number. A household picks how many days they want their current balance to last, and the app divides balance by days to get the actual daily allowance the meter enforces. Below that is a plain-language guide to the four load tiers: critical loads never get shed, essential loads go at 95 percent of budget used, optional loads at 85 percent, and luxury loads at 70 percent. A household can override any tier manually, forcing it on or off regardless of what the automatic logic would do.

Transfer lets a household send credit by email, wallet address, or QR code. Typing an email triggers a debounced lookup against the directory, and a resolved contact shows up as a small card with a name and address rather than a raw hex string. Before the transaction actually sends, there's a checklist confirming the recipient resolved, the amount is within the spendable balance, the wallet is on the right network, and there's enough gas, because blockchain transactions fail in ways that are confusing if you don't see them coming. Sending shows a real signing, submitted, and confirmed lifecycle rather than a spinner that just disappears.

History pulls actual on-chain events (mints, burns, and transfers) rather than keeping its own log, so what a household sees is independently verifiable on Polygonscan. There's a separate view of daily consumption as a bar chart for anyone who wants to see their usage pattern over time.

Profile has account details, the linked meter's code with an option to unlink it, notification preferences, and a language setting that's currently a stub (only English is implemented; I made a deliberate call early on to finish everything else before spending time on translations).

On top of all that, the app has a few things that aren't a specific screen: biometric quick-unlock that skips the email code for twelve hours after a full login, push notifications for top-ups, consumption, budget thresholds, and device pairing, and over-the-air updates through EAS Update, so a plain JavaScript change reaches installed apps without anyone needing to download a new APK. Anything involving a new native module still needs a fresh build, which is the one category of change that can't ship this way.

The visual design leans on West African textile and colour language rather than a generic dark dashboard: an indigo-tinted near-black background, laterite terracotta as the accent, and a warm off-white for the one card per screen meant to stand out. Three type families each have one job: Space Grotesk for headers, Inter for body text, and Space Mono reserved specifically for on-chain numbers like balances and wallet addresses.

## The backend

The Vercel functions under `app/api` handle everything that shouldn't happen directly from a phone with no oversight. Payments go through Flutterwave's hosted checkout; a webhook verifies a signed hash header, then independently re-checks the transaction's status with Flutterwave's own API rather than trusting whatever the webhook body claims, before minting anything. There's a retry endpoint for the rare case where a payment cleared but the on-chain mint transaction itself failed.

The consumption oracle reads each device's cumulative energy figure from Firebase, compares it against a stored watermark of how much has already been burned, and burns the difference. It runs on a schedule now through a GitHub Actions workflow rather than sitting idle, which it was doing for a while before I noticed nothing was actually calling it.

Device pairing and unpairing also live here, since letting a phone write directly to Firebase's device-binding paths would mean anyone could claim someone else's meter. And as of the latest pass, there's a session endpoint that verifies a wallet's own signature and issues this app's own session token -- replacing Firebase Anonymous Auth entirely, not just patching what it trusted -- which is worth its own explanation below.

## The physical meter

The ESP32 firmware, which I wrote and documented line by line earlier in this project, reads voltage, current, power, frequency, and power factor off a PZEM-004T V4 sensor over UART, shows readings on a 20x4 LCD, and drives four relays in the priority order the app promises: critical never sheds, essential goes at 95 percent, optional at 85, luxury at 70. It checks Firebase for any manual override before applying that automatic logic, matching exactly what the app lets a household set.

Because the raw meter-reading fields in Firebase are locked down to everyone except the meter itself, the firmware authenticates with a database secret rather than an ordinary user login, which is the standard approach for a device that isn't tied to any one person's session. Holding the setup button for three seconds puts the meter into pairing mode, at which point it writes its own device ID to a pending-pairing node with a one-hour expiry, and the app's pairing screen picks that up.

Two physical boards are flashed and running against the live backend now. They turned out to have opposite relay-module polarity from each other -- confirmed on the actual hardware, not assumed -- which the firmware handles as an explicit per-board `RELAY_CLOSED`/`RELAY_OPEN` constant, flipped before flashing whichever board doesn't currently match. Each device's own HMAC key (see "Getting the security right" below) is baked in at flash time, derived server-side from one master secret so the server never has to store a key per device, only re-derive it on demand.

## Getting the security right

This is the part of the project I ended up spending the most recent stretch of time on, and it's worth documenting honestly because a few of these issues were real, not hypothetical.

The double-spend problem I described in the contract section above was the first one I looked at closely. The fix (`pendingBurn`, enforced inside the contract's own transfer logic rather than only in the app) means the guarantee holds even against someone who bypasses the app entirely.

The second issue turned out to be more serious, and I only found it by going through every operation that changes state and asking, specifically, what stops someone from doing this without going through the app at all. The answer for `/uidToWallet`, the mapping every other Firebase rule relies on to know "this session belongs to this wallet," was: nothing. Firebase's anonymous sign-in is free and requires no identity whatsoever, and the old code let any session bind itself to any wallet address it wanted, with zero proof of ownership. That meant anyone could sign in anonymously, claim to be a specific victim's wallet, and from there read that household's live meter data or write their budget and relay overrides, including forcing the "critical, never shed" tier off entirely. I closed that by making the binding happen through a server endpoint that checks an actual signature from the wallet before Firebase ever trusts it, the same way you'd prove you own an email address by clicking a link sent to it, except here it's a cryptographic signature rather than a click.

Once that was fixed, two device-pairing endpoints had the same underlying problem in a smaller form: they trusted a wallet address handed to them in a plain HTTP request body instead of verifying who was actually calling. I changed both to derive the caller's wallet from a verified session token instead.

The signed `/uidToWallet` binding turned out to be an intermediate fix, not the final shape. Firebase Anonymous Auth itself kept causing real problems -- it's the endpoint that was silently blocked on some networks (see "The app, screen by screen" above) -- so it's gone now, not just patched. The app signs the same kind of message, but trades it for this project's own session token (`app/api/session/create.ts`) instead of a Firebase ID token, and the server never authenticates to Firebase as anything other than itself, via the Admin SDK. Net effect: the signature-based proof-of-ownership idea survived, the fragile Firebase-Auth dependency it was originally bolted onto didn't.

Each meter's `energyWh` field also picked up its own signature, separate from all of this: the shared database secret every meter uses can write anywhere, but `energyWh` is the one field that actually moves tokens (via the oracle's burn), so it's additionally signed with a key unique to that device (`app/api/_lib/meterHmac.ts`). A leaked shared secret can still forge what the dashboard displays, but not a reading the oracle will burn against.

There was also a smaller but real gap where a couple of endpoints only checked their shared secret if that secret happened to be configured, meaning a deployment that forgot to set an environment variable was silently wide open rather than safely locked. Those checks are fail-closed now: no secret configured means no requests get through, full stop.

The Flutterwave payment path, by contrast, held up well under the same scrutiny. Its webhook signature check, the mandatory re-verification against Flutterwave's own API, and the amount and currency cross-check were all already sound.

## Where things actually stand

The contract has sixteen passing Hardhat tests including the direct-bypass case, the app typechecks cleanly, and the Firebase rules and the latest contract are both live on their respective networks -- and, past where this document used to end, the physical proof is done too. Two ESP32 + PZEM-004T boards are flashed and running against the live backend: login, pairing, live budget enforcement, priority load shedding across all four relay channels, and a real `transfer()` have all been walked through end to end on real hardware, not left as a simulator-only claim. The security fixes above have also had a second-person pass rather than just my own reasoning and the contract-level tests.

What's still genuinely open: the consumption oracle's cron (`.github/workflows/burn-oracle.yml`) rides on GitHub Actions' scheduled-workflow delivery, which turned out to be far less reliable in practice than the 30-minute/hourly/daily cadence it's configured for -- observed gaps of several hours between firings. The daily budget-cycle reset has its own device-side fallback for this (the meter tracks local-midnight via NTP, with a 25-hour elapsed-time fallback if NTP never syncs), so it isn't actually blocked on the cron, but the token burn and `pendingBurn` refresh don't have an equivalent local fallback -- they're only as fresh as the last cron firing that actually landed. The workflow now runs all three oracle calls together on every firing instead of gating each to one specific cron expression, which helps, but doesn't fix GitHub's underlying delivery reliability. Multi-language support beyond English remains deliberately deferred.
