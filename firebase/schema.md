# Firebase Realtime Database schema

## `/meters/{deviceId}`

Written by the ESP32 meter (out of scope) once connected; until then, written
only by [`seed.ts`](seed.ts) for mock data. Read by the app's Dashboard, scoped
to whichever device the current wallet is bound to (see `/deviceToWallet` below).

```
/meters/{deviceId}/
    voltage:        number   (V)
    current:        number   (A)
    power:          number   (W)
    frequency:      number   (Hz, mains frequency -- PZEM-004T reports this directly)
    powerFactor:    number   (0-1, PZEM-004T reports this directly)
    energyWh:       number   (cumulative Wh this cycle)
    budgetWh:       number   (user-set DAILY budget, in Wh -- see unit note below)
    cycleStartedAt: number   (unix ms -- see cycle-signal note below)
    tokenBalance:   number   (household's spendable ENGY, in Wh -- see note below)
    percentUsed:    number   (0-100)
    relays:         { r1: bool, r2: bool, r3: bool, r4: bool }
    relayOverrides: { r1?: bool, r2?: bool, r3?: bool, r4?: bool }
    updatedAt:      number   (unix ms)
```

`{deviceId}` is a short code derived from the ESP32's MAC address (last 6 hex
characters, e.g. `3B9D88`), printed on the meter's LCD during setup. Relay
tiers, by priority: `r1` = Critical, `r2` = Essential, `r3` = Optional,
`r4` = Luxury. `true` = load is powered, `false` = load has been shed by the
budget enforcement logic on-device.

`relayOverrides` lets a user manually force a tier on or off from the app,
overriding the automatic budget-shedding decision for that tier. A missing key
means "auto" (firmware's own priority logic decides). Firmware is expected to
check `relayOverrides/{tier}` before applying its automatic decision -- if
present, it wins regardless of budget state. Written only by the app's
Dashboard/Budget screens (`src/services/relayOverride.ts`), one tier at a time.

`budgetWh` is written only by the app's Budget screen (`app/(tabs)/budget.tsx`
via `src/services/budget.ts`) -- last-write-wins, no merge logic, since only
the one household bound to this device can write here. The contract and this
field both stay in Wh (1 ENGY token = 1 Wh); the app is the only place that
ever shows the user "units" (1 unit = 1 kWh = 1,000 Wh = 1,000 ENGY), via
`src/services/units.ts`. Don't add a raw-Wh display anywhere in the UI --
always convert at the boundary.

`budgetWh` is a **daily** figure (`balance / durationDays`, computed once
when the household picks a duration), not a whole-period total. Its value
only ever changes when the household explicitly changes their plan, so a
firmware that resets its consumption cycle purely by detecting "did budgetWh
change" only gets one real day of allowance before shedding down for the
rest of the household's chosen period. `cycleStartedAt` is the dedicated
fix: firmware resets its local cycle whenever the value it reads back
differs from the last one it stored in NVS, independent of whether budgetWh
itself moved. Two things write it, atomically alongside `budgetWh` from
`setBudgetWh()` whenever a household sets or changes their plan (an
immediate reset), and a daily cron (`api/oracle/cycle-tick.ts`, see
`.github/workflows/burn-oracle.yml`) that rewrites it every 24 hours
regardless (the routine roll-over). Firmware should also keep a local
24-hour fallback that rolls the cycle on-device if no new signal has arrived
in time, so a missed cron run doesn't strand every meter shed to
critical-only until someone notices.

`tokenBalance` exists purely so a physical meter, which has no way to read
the blockchain itself, can show a household's balance on its own local
screen. The real balance lives on-chain (`spendableBalanceOf()` on
`EnergiToken.sol`); this is a best-effort mirror of that figure, written by
the app's Dashboard (`src/services/budget.ts`'s `setMeterTokenBalance`)
every time it refreshes the on-chain balance. It's spendable balance being
mirrored here, not raw on-chain balance, for the same reason the app shows
spendable everywhere else: it's what the household actually still has to
use. Same write scoping as `budgetWh`.

## `/deviceToWallet/{deviceId}` and `/walletToDevice/{wallet}`

The pairing a household creates once, during onboarding, by typing their
meter's device code into the app. Both directions are stored so the app can
go wallet → device (to know which `/meters/{deviceId}` to listen to) and the
rules can go device → wallet (to check who's allowed to touch a given meter).

```
/deviceToWallet/{deviceId}: walletAddress
/walletToDevice/{wallet}: deviceId
```

Both are write-once per key: a device can only ever be claimed by one wallet,
and a wallet can only ever be bound to one device. The app checks
`/deviceToWallet/{deviceId}` before writing and shows an explicit error if the
device is already claimed by a different wallet; the security rules enforce
the same constraint server-side as a backstop (see
[`database.rules.json`](database.rules.json)).

## `/directory/{emailKey}`

Maps a login email to the wallet address Privy created for it, so the Transfer
screen can resolve "send to someone@example.com" to an on-chain address.
Written once at login by the app; read whenever a user enters an email as a
transfer recipient.

```
/directory/{emailKey}: walletAddress
```

Firebase Realtime Database keys cannot contain `.`, `#`, `$`, `[`, `]`, or `/`.
`{emailKey}` is the email with every `.` replaced by `,` (comma), e.g.
`alice.example@gmail.com` → `alice,example@gmail,com`. This is a simple,
reversible, human-readable encoding — no hashing/base64 needed since the value
is only ever looked up by reconstructing the same substitution, never displayed
as a raw key.

## `/uidToWallet/{uid}`

Binds a Firebase Anonymous Auth session (`uid`) to the wallet address that
session is allowed to act as. This is the mechanism every other rule uses to
scope access back to "the caller's own wallet" — see
[`database.rules.json`](database.rules.json) for the enforcement logic, and
the build plan's notes for why this indirection exists (Privy, not Firebase
Auth, owns wallet identity).

`.write` is `false` for every client — Anonymous Auth alone proves nothing
about which wallet a session should be trusted for (anyone can sign in
anonymously for free), so a plain client write here would let anyone bind
their own session to any victim's wallet address and inherit every rule that
trusts this mapping (meter reads, `budgetWh`, `relayOverrides` writes). The
binding is instead created by `app/api/session/bind.ts`, which requires the
wallet to sign `EnergiToken session bind\nuid:{uid}\nwallet:{walletAddress}`
(see `src/services/bindMessage.ts`) and verifies that signature server-side
before writing via the Admin SDK — write-once per `uid`, same as before.

```
/uidToWallet/{uid}: walletAddress
```
