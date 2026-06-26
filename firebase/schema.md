# Firebase Realtime Database schema

## `/meters/{walletAddress}`

Written by the ESP32 meter (out of scope) once connected; until then, written only
by [`seed.ts`](seed.ts) for mock data. Read by the app's Dashboard.

```
/meters/{walletAddress}/
    voltage:      number   (V)
    current:      number   (A)
    power:        number   (W)
    energyWh:     number   (cumulative Wh this cycle)
    budgetWh:     number   (user-set budget)
    percentUsed:  number   (0-100)
    relays:       { r1: bool, r2: bool, r3: bool, r4: bool }
    updatedAt:    number   (unix ms)
```

`{walletAddress}` is the household's wallet address as returned by Privy, e.g.
`0xDC86E1E8A5C72cce432E99483A20B19802A47ccD`. Relay tiers, by priority:
`r1` = Critical, `r2` = Essential, `r3` = Optional, `r4` = Luxury. `true` = load is
powered, `false` = load has been shed by the budget enforcement logic on-device.

## `/directory/{emailKey}`

Maps a login email to the wallet address Privy created for it, so the Transfer
screen can resolve "send to someone@example.com" to an on-chain address. Written
once at login by the app (see Step 8 in the build plan); read whenever a user
enters an email as a transfer recipient.

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
the mechanism the security rules use to scope `/meters/{wallet}` access — see
[`database.rules.json`](database.rules.json) for the enforcement logic, and the
build plan's Step 3/6 notes for why this indirection exists (Privy, not Firebase
Auth, owns wallet identity).

```
/uidToWallet/{uid}: walletAddress
```
