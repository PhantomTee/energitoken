# Firebase Realtime Database schema

## `/meters/{deviceId}`

Written by the ESP32 meter (out of scope) once connected; until then, written
only by [`seed.ts`](seed.ts) for mock data. Read by the app's Dashboard, scoped
to whichever device the current wallet is bound to (see `/deviceToWallet` below).

```
/meters/{deviceId}/
    voltage:      number   (V)
    current:      number   (A)
    power:        number   (W)
    energyWh:     number   (cumulative Wh this cycle)
    budgetWh:     number   (user-set budget)
    percentUsed:  number   (0-100)
    relays:       { r1: bool, r2: bool, r3: bool, r4: bool }
    updatedAt:    number   (unix ms)
```

`{deviceId}` is a short code derived from the ESP32's MAC address (last 6 hex
characters, e.g. `3B9D88`), printed on the meter's LCD during setup. Relay
tiers, by priority: `r1` = Critical, `r2` = Essential, `r3` = Optional,
`r4` = Luxury. `true` = load is powered, `false` = load has been shed by the
budget enforcement logic on-device.

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
session is allowed to act as. Written exactly once per device session, right
after the app signs in anonymously following a successful Privy login. This is
the mechanism every other rule uses to scope access back to "the caller's own
wallet" — see [`database.rules.json`](database.rules.json) for the enforcement
logic, and the build plan's notes for why this indirection exists (Privy, not
Firebase Auth, owns wallet identity).

```
/uidToWallet/{uid}: walletAddress
```
