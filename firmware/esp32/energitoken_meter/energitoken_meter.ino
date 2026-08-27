/*
 * ============================================================================
 *  EnergiToken  —  ESP32 Meter Firmware  v2.0
 *  IoT-Based Secured Smart Energy Budgeting System with Priority Load Shedding
 * ----------------------------------------------------------------------------
 *  Shuaib Thalhat Adeiza  (2021/1/80760ET)
 *  Supervisor: Dr. Ajao Lukman
 *  Mechatronics Engineering, Federal University of Technology, Minna
 * ----------------------------------------------------------------------------
 *  Board  : ESP32 NodeMCU-32S        Framework : Arduino
 *
 *  Libraries (Arduino IDE > Library Manager):
 *    PZEM004Tv30          — Jakub Mandula
 *    LiquidCrystal_I2C    — Frank de Brabander
 *    Firebase ESP Client  — Mobizt
 *
 *  Board settings:
 *    Board          : ESP32 Dev Module
 *    Upload Speed   : 921600
 *    Flash Frequency: 80 MHz
 *    Partition      : Minimal SPIFFS (1.9MB APP with OTA/128KB SPIFFS)
 *
 *  CHANGES FROM v1
 *    - Firebase authenticates with a database secret (device credential),
 *      matching the access-control model where raw meter fields are not
 *      writable by any consumer session.
 *    - Manual relay overrides are read as BOOLEANS from
 *      /meters/{id}/relayOverrides/{r1..r4}. A missing key means auto.
 *      An override always beats the automatic threshold decision, except
 *      that r1 Critical can never be forced off.
 *    - Pairing mode: hold ENTER for 3 s. The meter publishes to
 *      /pendingDevices/{deviceId} with a single field, createdAt.
 *      ENTER is reused deliberately — the fabricated PCB has no pad for a
 *      separate setup button.
 *    - energyWh is the consumption for the CURRENT BUDGET CYCLE ONLY. The
 *      baseline resets whenever a new budgetWh value arrives from the app.
 *    - The firmware never writes budgetWh or relayOverrides. Those belong
 *      to the app and writing them would overwrite the household's setup.
 *    - All energy values are raw watt-hours. kWh appears nowhere.
 *    - No NTP client. Every timestamp written to the database uses
 *      Firebase's server-side sentinel, and the pairing countdown is a
 *      relative interval, so no wall-clock source is required on device.
 *    - Keypad is a real 4x3 matrix, not four discrete buttons. Confirmed
 *      against the actual KiCad PCB: only two rows are wired (ROW1 = 1,2,3
 *      and ROW4 = *,0,#), giving six live keys. 1/2 are up/down, * is
 *      back/cancel, # is confirm (hold 3 s from the live screen to enter
 *      pairing mode). 3 jumps straight to the Device ID screen, 0 jumps
 *      straight to the balance screen, both otherwise unused.
 *    - Pairing mode now confirms success on its own. While active it polls
 *      /pendingDevices/{deviceId}/claimed every few seconds, and the moment
 *      the app finishes claiming the device, shows "PAIRED!" and returns to
 *      the live screen automatically instead of sitting on the countdown
 *      until BACK is pressed or the hour runs out either way.
 *    - Fixed two real bugs in the hold-to-pair logic, found by reading the
 *      Keypad library's own source rather than assuming its behaviour.
 *      First: '#' on the live screen used to commit to "enter menu" on the
 *      very first PRESSED event, before the library even knew whether it'd
 *      become a hold, which moved ui off UI_LIVE immediately and meant the
 *      pairing hold could never pass its own "still on the live screen"
 *      check. Second, and the one that made the first fix's own HOLD check
 *      silently never fire: Keypad::getKey() only ever returns a character
 *      when key[0].kstate==PRESSED (see Keypad.cpp), never on HOLD or
 *      RELEASED, so checking `key == '#'` against getKey()'s return value
 *      was always false at the exact moment the hold completed. Fixed by
 *      calling getKey() only for its scanning side effect and reading
 *      kpd.key[0].kchar/kstate/stateChanged directly instead, which
 *      genuinely reflects the current state on every transition.
 *    - Every key press beeps now, including '#' before it's known whether
 *      it'll become a hold, so a press is always audibly confirmed. Pairing
 *      mode also beeps once a second the whole time it's active, an audible
 *      heartbeat so it's obvious it's still genuinely running.
 *    - Partition scheme changed to "Minimal SPIFFS (1.9MB APP with OTA/
 *      128KB SPIFFS)" -- flash was at 97% under the default 1.25MB app
 *      partition, almost entirely from the Firebase library's bundled
 *      Firestore/Functions/Storage/Messaging code that this firmware never
 *      calls (it only ever uses Firebase.RTDB.*), plus its own TLS stack.
 *      This board never uses SPIFFS, so trading that space for app space
 *      costs nothing and was the safe fix -- rewriting off the Firebase
 *      library entirely would free even more but means re-touching every
 *      RTDB call site, real risk this close to a deadline.
 *    - pullConfig() consolidated into ONE Firebase.RTDB.getJSON() call
 *      instead of 6 separate blocking round-trips. At the faster FB_PULL_MS
 *      above, 6 sequential blocking network calls per cycle starved the
 *      main loop badly enough that keypad presses were scanned late or
 *      mid-transition -- a press would eventually beep once the loop
 *      unblocked, but the actual menu action was already lost.
 *    - Budget cycles are now driven by /meters/{id}/cycleStartedAt (unix
 *      ms), ported from a parallel firmware draft, not by budgetWh simply
 *      changing value. The old trigger meant a household keeping the exact
 *      same daily budget every day -- i.e. budgeting correctly -- would
 *      never get a fresh cycle. The app writes cycleStartedAt atomically
 *      with budgetWh on any plan change, and a daily cron rewrites it; this
 *      firmware stores the last value seen in NVS and starts a new cycle
 *      whenever it differs. A local fallback (Section 10) rolls the cycle
 *      after 25h without a signal, so a late or failed cron can't strand a
 *      meter at critical-only. initClock()/NTP (Section 6b) is defined but
 *      deliberately NOT called from setup() -- confirmed on real hardware
 *      that configTime() there hits a hard lwIP assertion and force-reboots
 *      the board on every cold boot. The fallback already degrades safely
 *      to millis()-based local timing with no wall clock at all, so this
 *      trades a minor precision nicety for not crashing on boot.
 *    - The live screen marks a reading stale ("!!") after 5 consecutive
 *      PZEM read failures, also ported from that same draft, so a sensor
 *      that's stopped answering isn't mistaken for one still reporting
 *      real numbers.
 *    - makeDeviceID() switched from WiFi.macAddress() to
 *      esp_base_mac_addr_get(). The former calls esp_netif_get_mac()
 *      internally, which requires the STA network interface to already
 *      exist -- it doesn't here, since this runs before connectWiFi() ever
 *      calls WiFi.mode(). On failure it silently leaves its output buffer
 *      untouched, so deviceID had been reading uninitialized stack garbage
 *      the entire project, not a real MAC -- stable-looking only because
 *      the same compiled binary leaves the same leftover bytes each time,
 *      until a recompile shifts the stack layout and the "device" changes
 *      identity. Confirmed on two separate boards via `esptool read-mac`
 *      (queries the chip directly, no WiFi driver involved) returning a
 *      completely different, correct MAC than this function had been
 *      reporting. esp_base_mac_addr_get() reads eFuse directly -- no
 *      WiFi/netif state required, so the failure mode doesn't exist.
 *    - applyOverrides() is no longer called from inside runAlgorithm(),
 *      which only runs `if (meas.valid)`. That meant a loose PZEM sensor
 *      lead silently froze manual relay overrides along with the budget
 *      algorithm, even though forcing a relay has nothing to do with
 *      whether the current sensor is answering. It now runs on its own
 *      OVERRIDE_APPLY_MS timer in loop(), independent of PZEM state.
 *    - New zero/unknown-balance gate (applyBalanceGate(), Section 10): with
 *      no *confirmed* purchased credit, every relay opens, deliberately
 *      including the critical tier -- unlike runAlgorithm()'s threshold
 *      shedding, which protects critical from being sacrificed for
 *      lower-priority loads *while there's still budget left*. The two
 *      aren't in tension: one is about triage during a paid cycle, the
 *      other is about not running on credit that was never purchased. This
 *      fails CLOSED on purpose: a board that has never synced a real
 *      balance at all gets no power until Firebase actually confirms some,
 *      same as a confirmed zero -- not "assume it's fine" in the meantime.
 *      NVS persistence is what keeps this from re-gating a board on every
 *      ordinary reboot; see the fuller reasoning on applyBalanceGate()
 *      itself. A top-up that brings the balance to a confirmed positive
 *      restores every tier immediately and beeps a dedicated pattern; the
 *      live screen shows a "TOP UP RECEIVED" notice
 *      for a few seconds first, sourced from the same tokenBalance pull
 *      already used for the balance screen.
 *    - The gate is authoritative via a `balanceGated` flag, not just a
 *      third independent writer. An earlier version had this gate (500ms
 *      timer), runAlgorithm() (2s timer), and applyOverrides() all writing
 *      relayState directly: at zero balance budget.percent reads 0, which
 *      satisfies every tier's *restore* condition, so runAlgorithm() would
 *      close every relay this gate had just opened, and the gate would
 *      reopen them 500ms later -- ~1800 open-close cycles/hour per channel,
 *      audible and mechanically damaging. runAlgorithm() and
 *      applyOverrides() both now check balanceGated and stand down while
 *      it's set, and loop() runs the gate first specifically so the flag is
 *      current before anything else reads it that cycle.
 *    - tokenBal/tokenBalKnown are now persisted to NVS, and initRelays()
 *      restores balanceGated from them (derived right after loadNVS(), before
 *      initRelays() runs) instead of unconditionally closing everything at
 *      boot. Without this, a household already gated off for zero credit
 *      got full power, critical tier included, for the entire boot sequence
 *      -- worst case ~30s+ waiting on WiFi/Firebase before the gate ever got
 *      a chance to correct it.
 *    - Boot-time WiFi budget cut from 30s to 5s (WIFI_TIMEOUT_MS), and the
 *      trailing 1.5s delay in connectWiFi() dropped. The meter is built to
 *      run offline and shed correctly without a network at all -- blocking
 *      half a minute for a connection it doesn't strictly need, before the
 *      household even gets a real balance decision, was wasted time. WiFi's
 *      own driver keeps retrying in the background regardless.
 *    - The WiFi setup portal (hold * for 3s, temporary hotspot + web form)
 *      has been removed. It solved a real problem earlier in the project
 *      when the network was still unsettled, but every meter is now
 *      hardcoded to one known MiFi network, so the portal was dead weight
 *      -- kept only loadWiFiCreds() (still reads a saved network from NVS
 *      if one's ever written some other way, falling back to the
 *      WIFI_SSID/WIFI_PASSWORD defaults below) and saveWiFiCreds() (unused
 *      for now, kept because any future reconfiguration mechanism would
 *      want the exact same NVS schema).
 *    - kpd.setDebounceTime(50) added -- the Keypad library's own 10ms
 *      default is short enough that a membrane pad's 5-20ms bounce could
 *      occasionally register as two presses.
 *    - evalChannel() now skips any tier with overridePresent[idx] set. It
 *      previously ran regardless of overrides, so runAlgorithm()'s 2s timer
 *      and applyOverrides()' 500ms timer fought over the same relay --
 *      restore, force-off, restore, force-off -- an audible, mechanically
 *      damaging loop for as long as the override stood. Same class of bug
 *      as the balance-gate-vs-runAlgorithm fight above, just with overrides
 *      as the second writer this time.
 *    - relayOverrides now has its own Firebase realtime stream (Section
 *      14b) alongside the existing FB_PULL_MS poll, so an app-side tap
 *      lands in well under a second instead of waiting up to 2.5s
 *      (FB_PULL_MS + OVERRIDE_APPLY_MS). The stream is only a change
 *      signal -- pullOverridesNow() re-reads with the same plain getJSON()
 *      pullConfig() already uses, rather than hand-parsing the stream's own
 *      put/patch delta payload.
 *    - Critical (R1) now sheds too, via evalChannel(0, THRESH_R1=100%),
 *      instead of being unconditionally restored every cycle regardless of
 *      budget. This is a deliberate design change: the household's own
 *      chosen budget can now cut everything, critical included, once fully
 *      used -- but an app override can still bring critical back on
 *      afterward (spending from balance outside today's budgeted
 *      allowance), and the separate zero-*balance* gate is unaffected and
 *      remains absolute (see applyBalanceGate()'s own comment).
 *    - applyBalanceGate() now clears every relayOverrides key, locally and
 *      in Firebase, the moment it newly gates (not on every cycle it's
 *      still gated). Without this a stale "forced on" override from before
 *      the household ran out of credit would silently reassert itself the
 *      instant balance was restored.
 *    - Buzzer cutoff logic moved from an inline call inside evalChannel's
 *      shed branch to checkRelayTransitions() (Section 5b), a single
 *      before/after relayState comparison run every loop() iteration. The
 *      old design only beeped for a threshold-crossing shed; a relay cut by
 *      a manual override or the balance gate beeped nothing at all. The
 *      generic transition check catches every cause in one place.
 *    - NTP is now actually enabled. initClock() no longer blocks (it used to
 *      spin-wait up to 8s for sync, which would have starved the keypad/PZEM
 *      loop badly if called from anywhere but setup()) -- configTzTime()
 *      just fires off ESP-IDF's SNTP client, which keeps itself synced in
 *      the background from then on, no waiting required. It's called once
 *      from loop() the first time wifiUp is true, NOT from setup() -- the
 *      lwIP assertion/reboot mentioned above was specifically about calling
 *      configTime() that early, before the network stack had settled;
 *      waiting for the first loop() pass (after setup() has already
 *      finished LCD/Firebase/keypad init) avoids that entirely. Timezone is
 *      fixed to WAT-1 (UTC+1, no DST) for where these meters are deployed.
 *    - New checkLocalMidnight() (Section 10), checked every loop() pass:
 *      once NTP is synced, the moment the local calendar day changes it
 *      starts a fresh budget cycle directly, no dependency on the daily
 *      GitHub Actions cron or the next Firebase poll -- gets a cycle reset
 *      within a second or two of true local midnight instead of whatever
 *      time cycleOverdue()'s millis()-based fallback happens to drift to
 *      (which is what had been resetting cycles at arbitrary times of day).
 *      That existing fallback is untouched and still covers a meter that
 *      never gets NTP sync at all. A locally-triggered reset also writes
 *      cycleStartedAt back to Firebase (publishCycleStartedAt()) so the
 *      app's Budget page shows the real cycle-start time instead of a stale
 *      one from the last cron tick.
 *    - New budgetClearedAt handling in pullConfig() (edge-triggered, same
 *      pattern as cycleStartedAt): budgetWh itself was structurally unable
 *      to signal "clear the budget" -- pullConfig() deliberately ignores a
 *      zero or absent budgetWh so a stale write can never accidentally zero
 *      out a real budget, which also meant there was no way to un-set one
 *      at all. The app's new "Reset Budget" button writes this dedicated
 *      signal instead; on change, drops back to budgetSet=false (fully
 *      unrestricted, no automatic shedding) and clears every relay
 *      override via the new shared clearAllOverrides() (factored out of
 *      applyBalanceGate(), which used the same clear-on-Firebase-and-
 *      locally logic already).
 *    - initRelays() now always starts every relay OFF, full stop. The
 *      previous version used the balance persisted in NVS to decide the
 *      very first digitalWrite() -- correct for a board that was already
 *      gated off, but still optimistically turned everything on for a
 *      board that merely looked fine last time it checked, and that
 *      snapshot can be stale (spent from the app while the meter was
 *      powered off, budget exhausted overnight while offline, etc.).
 *      Relays now only come on once the real, fresh check has actually run
 *      -- applyBalanceGate()/runAlgorithm() on their normal loop() timers,
 *      once WiFi/Firebase has confirmed the household's real current state.
 * ============================================================================
 */

#include <math.h>
#include <WiFi.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <PZEM004Tv30.h>
#include <Preferences.h>
#include <Keypad.h>
#include <Firebase_ESP_Client.h>
#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>
#include <mbedtls/md.h>  // part of ESP-IDF -- no new library, used only for the meter's HMAC-SHA256 signature
#include <time.h>        // NTP wall clock, used only for the cycle-rollover fallback (Section 6b)
#include <esp_mac.h>     // esp_base_mac_addr_get() -- see makeDeviceID() in Section 6

/* ===========================================================================
 *  SECTION 1 — PIN MAP   (matches the fabricated KiCad board)
 * ===========================================================================*/
#define PZEM_RX_PIN     16      // ESP32 RX2  <— PZEM TX   (lines cross over)
#define PZEM_TX_PIN     17      // ESP32 TX2  —> PZEM RX

#define LCD_SDA_PIN     21
#define LCD_SCL_PIN     22
#define LCD_I2C_ADDR    0x27
#define LCD_COLS        20
#define LCD_ROWS        4

#define RELAY_R1_PIN    32      // Critical   — never sheds
#define RELAY_R2_PIN    33      // Essential  — sheds at 95 %
#define RELAY_R3_PIN    25      // Optional   — sheds at 85 %
#define RELAY_R4_PIN    18      // Luxury     — sheds at 70 %

// 4x3 matrix keypad, only two rows wired (confirmed against the real board).
// Row order matches the physical pad: ROW1 = 1,2,3 / ROW4 = *,0,#.
#define KP_ROWS 2
#define KP_COLS 3

#define BUZZER_PIN      23

/* ===========================================================================
 *  SECTION 2 — CONSTANTS
 * ===========================================================================*/
// *** PER-BOARD *** -- the two physical meters have opposite relay-module
// polarity. ESP-A (device 4BF6F0, confirmed via esp_base_mac_addr_get() --
// see makeDeviceID()) is active-low: LOW energises the coil, which is what
// these two lines are set for right now. ESP-B (device F94098) is the
// opposite -- active-high, confirmed on the actual hardware 2026-08-27.
// Flip both lines (swap LOW<->HIGH) before reflashing whichever board these
// values don't currently match, and flip them back before ever reflashing
// the other one again.
#define RELAY_CLOSED    LOW     // active-low board (ESP-A): LOW energises the coil
#define RELAY_OPEN      HIGH

#define THRESH_R4       70.0f
#define THRESH_R3       85.0f
#define THRESH_R2       95.0f
#define THRESH_R1       100.0f    // critical now sheds too, once the household's own budget is fully used
#define HYSTERESIS      3.0f

// This board's PZEM reads voltage low by a small, consistent amount --
// measured 228-229V against a multimeter reading 234-235V on the same
// line, roughly a 2.5% offset, typical for these modules without factory
// calibration. Corrected here in software rather than touching the PZEM's
// own internal calibration, which carries real risk of permanently
// miscalibrating the unit for a fix this size. Only voltage is corrected --
// current/power/energy weren't independently verified against a reference,
// so they're left as the sensor reports them rather than assuming the same
// offset applies. Re-measure and adjust this if the board or sensor changes.
#define VOLTAGE_CAL_FACTOR  1.026f   // 234.5 / 228.5, from the reference readings above

#define POLL_MS             2000UL
#define LCD_MS              1000UL
#define FB_PUSH_MS          5000UL
#define FB_PULL_MS          2000UL     // was 10s -- arbitrary choice, no real cost reason to keep a single device this slow
#define OVSTREAM_CHECK_MS     30UL     // how often loop() services the relayOverrides realtime stream
#define KEY_DEBOUNCE_MS      200UL
#define MENU_TIMEOUT_MS    15000UL
// Boot-time budget only. The meter is built to run offline and shed
// correctly without a network at all, so blocking half a minute here for a
// connection it doesn't strictly need was wasted time -- worst case in the
// old boot-timing analysis, ~38s before the first real balance decision.
// WiFi's own driver keeps retrying in the background regardless (it's
// never told to stop via WiFi.disconnect()); loop()'s existing
// WiFi.status() check picks up a later success on its own.
#define WIFI_TIMEOUT_MS     5000UL
#define PAIR_HOLD_MS        3000UL
#define PAIR_WINDOW_MS   3600000UL     // one hour
#define PAIR_CHECK_MS       3000UL     // how often to poll for a successful claim
#define PAIR_BEEP_MS        1000UL     // audible heartbeat while pairing is active

#define DEFAULT_PERIOD_DAYS   30

// Local cycle-rollover fallback. One hour of grace past 24h so a cron
// running slightly late doesn't race the meter into rolling the cycle
// itself.
#define CYCLE_GRACE_MS   90000000ULL     // 25 hours
#define CYCLE_CHECK_MS      60000UL      // evaluate the fallback each minute

// Consecutive failed PZEM reads before the display marks the reading stale.
#define PZEM_STALE_COUNT        5

// How often manual overrides and the zero-balance gate are reconciled.
// Independent of POLL_MS/PZEM entirely -- see the comment on the loop()
// call site for why that independence matters.
#define OVERRIDE_APPLY_MS     500UL

/* ===========================================================================
 *  SECTION 3 — CREDENTIALS      ***  EDIT BEFORE FLASHING  ***
 * ===========================================================================*/
// Mutable (not const): these are the first-boot defaults only. Once a real
// network is saved through the WiFi setup portal (hold * for 3s on the live
// screen), the saved value in NVS overrides these on every subsequent boot --
// see loadWiFiCreds() in Section 7. Sized for WiFi's real limits: SSID up to
// 32 chars, password up to 64, both plus a null terminator.
char WIFI_SSID[33]     = "testing";
char WIFI_PASSWORD[65] = "testing123";

// Realtime Database URL, e.g. "energitoken-xxxx-default-rtdb.firebaseio.com"
#define FB_HOST     "energitoken-b5ab3-default-rtdb.firebaseio.com"

// Database secret — Firebase console > Project settings > Service accounts
// > Database secrets. This is the device credential referred to in Ch. 3.
// NOT committed: this is a bearer credential with full read/write across the
// whole database, not just this device. Fill in locally from the Firebase
// console before compiling/flashing -- never paste the real value here in
// a commit, this repo is public.
#define FB_SECRET   ""

// This device's own HMAC-SHA256 key, unique to THIS board -- derived as
// HMAC(masterSecret, deviceID) and computed once on the server side, never
// transmitted. Signs energyWhInt in every push (see pushState in Section
// 13) so the oracle can trust a consumption reading enough to burn tokens
// against it, even though FB_SECRET above is a shared, database-wide
// credential that alone can't be trusted for that. Regenerate + reflash
// with a new key if this specific board's flash is ever compromised --
// it can't be used to derive any other device's key.
// ESP-A (device 4BF6F0): HMAC(masterSecret, "4BF6F0"). Rotated 2026-08-27 --
// the prior masterSecret had never been backed up locally, so it was
// regenerated instead of recovered. The new masterSecret is backed up in
// app/.env and Downloads/METER_HMAC_MASTER_SECRET.txt this time. This key
// and the server's METER_HMAC_MASTER_SECRET env var were derived together
// from that same new masterSecret, so they match -- this board must be
// reflashed with this key before its consumption reports will verify again.
// NOT committed: fill in the per-board value locally before flashing (see
// app/api/_lib/meterHmac.ts for how it's derived server-side) -- never
// paste a real derived key here in a commit, this repo is public.
#define METER_HMAC_KEY_HEX ""

/* ===========================================================================
 *  SECTION 4 — OBJECTS AND STATE
 * ===========================================================================*/
LiquidCrystal_I2C lcd(LCD_I2C_ADDR, LCD_COLS, LCD_ROWS);
PZEM004Tv30       pzem(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);
Preferences       prefs;

// Matrix keypad. Row/col pins and the keymap itself, both confirmed against
// the fabricated board: ROW1=GPIO13, ROW4=GPIO14, COL1=GPIO27, COL2=GPIO26,
// COL3=GPIO19. Six live keys: 1 2 3 / * 0 #.
char KEY_MAP[KP_ROWS][KP_COLS] = {
  { '1', '2', '3' },
  { '*', '0', '#' }
};
byte KP_ROW_PINS[KP_ROWS] = { 13, 14 };
byte KP_COL_PINS[KP_COLS] = { 27, 26, 19 };
Keypad kpd = Keypad(makeKeymap(KEY_MAP), KP_ROW_PINS, KP_COL_PINS, KP_ROWS, KP_COLS);

FirebaseData   fbdo;
FirebaseAuth   fbAuth;
FirebaseConfig fbCfg;
// Separate FirebaseData object dedicated to the relayOverrides realtime
// stream (Section 15b) -- Mobizt requires a stream to own its FirebaseData
// instance rather than share one with plain get/set calls on fbdo.
FirebaseData   ovStream;

struct Meas {
  float voltage = 0, current = 0, power = 0;
  float energy  = 0;                 // Wh, cumulative from the module
  float freq    = 0, pf = 0;
  bool  valid   = false;
} meas;

struct Budget {
  float    totalWh    = 0;           // B, budgetWh received from the app
  float    baselineWh = 0;           // E0, sensor reading when the cycle began
  float    cycleWh    = 0;           // Ec, consumption in this cycle only
  float    percent    = 0;           // beta

  uint32_t days       = DEFAULT_PERIOD_DAYS;   // local display only

  // Two flags with two distinct meanings. They were previously one
  // variable, which caused a correct baseline to be discarded on reboot.
  bool     budgetSet   = false;      // the app has supplied a real budgetWh
  bool     baselineSet = false;      // a baseline exists for the current cycle

  // Last cycleStartedAt seen from the database, unix ms. Persisted so a
  // reboot doesn't re-trigger a cycle that's already been applied.
  uint64_t cycleStartedAt = 0;

  // Last budgetClearedAt seen from the database, unix ms. Edge-triggered
  // signal (same idea as cycleStartedAt) that the household reset their
  // budget entirely -- budgetWh itself can't communicate "go back to
  // unrestricted", since pullConfig() deliberately ignores a zero/absent
  // budgetWh so a stale write can never accidentally zero out a real
  // budget. See pullConfig() below.
  uint64_t budgetClearedAt = 0;
} budget;

// millis() when this device last began a cycle -- used only by the local
// fallback when no wall clock is available yet.
uint32_t cycleLocalStart = 0;

// Set once NTP sync has been requested, so loop() only calls initClock() a
// single time per boot -- the SNTP client keeps itself resynced afterward.
bool clockInitStarted = false;

// Local calendar day (tm_yday, 0-365) last seen by checkLocalMidnight(), or
// -1 before the first NTP sync of this boot. Not persisted -- a reboot
// re-derives it within seconds of reconnecting, and being wrong for one
// boot means at most one skipped or harmlessly-repeated check, never a
// wrong reset.
int lastSeenYday = -1;

// Consecutive PZEM read failures. Reset to zero on any successful read.
uint16_t pzemFailCount = 0;

// true = CLOSED = load powered
bool  relayState[4] = { true, true, true, true };

// Snapshot of relayState from the end of the previous loop() iteration, used
// purely to detect on->off transitions for the buzzer (Section 5b) -- set to
// match relayState's actual post-boot value in setup(), not the compile-time
// default above, so a board that boots already gated doesn't fire a false
// "just cut off" beep for relays that were never on this boot.
bool  prevRelayState[4] = { true, true, true, true };

// Manual overrides from /meters/{id}/relayOverrides/{r1..r4}
//   overridePresent[i] == false  ->  no key in the database, tier is auto
//   overridePresent[i] == true   ->  overrideValue[i] forces the tier
bool overridePresent[4] = { false, false, false, false };
bool overrideValue[4]   = { false, false, false, false };

const uint8_t RELAY_PINS[4] = { RELAY_R1_PIN, RELAY_R2_PIN,
                                RELAY_R3_PIN, RELAY_R4_PIN };
const char*   TIER_NAME[4]  = { "Critical", "Essential", "Optional", "Luxury" };

String   deviceID      = "";
bool     wifiUp        = false;
bool     fbReady       = false;
bool     pairingActive = false;
uint32_t pairingStart  = 0;

uint32_t tPoll = 0, tLcd = 0, tPush = 0, tPull = 0, tPairCheck = 0, tPairBeep = 0, tCycle = 0, tOverride = 0, tOvStream = 0;

enum Ui { UI_LIVE, UI_MENU, UI_DAYS, UI_RELAYS, UI_BAL, UI_ID, UI_PAIR };
Ui       ui         = UI_LIVE;
int      menuIdx    = 0;
uint32_t menuTouch  = 0;
uint32_t inputDays  = DEFAULT_PERIOD_DAYS;
float    tokenBal   = 0;

// tokenBalKnown stays false until the very first real tokenBalance arrives
// from Firebase -- the zero-balance gate below must never fire off of the
// startup default (which is indistinguishable from a genuine zero without
// this flag), or every reboot would blank the critical tier for however
// long WiFi/Firebase takes to reconnect, even with real credit on the wallet.
bool     tokenBalKnown     = false;
uint32_t topUpNoticeUntil  = 0;      // millis() deadline; live screen shows the top-up notice until then
float    lastTopUpAmount   = 0;

// True whenever applyBalanceGate() has the relays forced off for zero
// credit. Authoritative, not just informational: runAlgorithm() and
// applyOverrides() both check it and stand down while it's set, so the
// gate is the only writer touching the relays at zero balance instead of
// three independent writers on three different timers fighting each other
// every cycle. See the precedence table on applyBalanceGate() itself.
bool     balanceGated      = false;

const char* MENU[4] = { "1 Set budget days",
                        "2 Relay states",
                        "3 Token balance",
                        "4 Device ID" };
#define MENU_N 4

/* ===========================================================================
 *  SECTION 5 — BUZZER
 * ===========================================================================*/
void beep(uint16_t on, uint16_t off, uint8_t n) {
  for (uint8_t i = 0; i < n; i++) {
    digitalWrite(BUZZER_PIN, HIGH); delay(on);
    digitalWrite(BUZZER_PIN, LOW);
    if (i < n - 1) delay(off);
  }
}
// One pattern per tier, distinct enough to tell apart by ear without
// looking at the LCD. Called from checkRelayTransitions() below on any
// on->off transition, whatever caused it (threshold shed, manual override,
// or the balance gate) -- not just the threshold-crossing case this used
// to be limited to.
void beepCutoff(uint8_t tierIdx) {
  switch (tierIdx) {
    case 0: beep(200, 120, 4); break;   // R1 critical   — four long, most severe
    case 1: beep( 60,  60, 3); break;   // R2 essential  — three rapid
    case 2: beep(120, 150, 2); break;   // R3 optional   — two short
    case 3: beep(120, 150, 1); break;   // R4 luxury     — one short
  }
}
void beepTopUp()  { beep(600, 0, 1); }
void beepKey()    { beep( 25, 0, 1); }
void beepPair()   { beep(200, 120, 2); }

/* ---------------------------------------------------------------------------
 *  SECTION 5b — BUZZER: GENERIC CUTOFF DETECTION
 *
 *  "Was this relay on last cycle, and is it off now?" -- checked once per
 *  loop() iteration, independent of which subsystem (evalChannel's
 *  threshold shed, applyOverrides, or applyBalanceGate) actually flipped
 *  it. The old design only beeped from inside evalChannel's shed branch,
 *  so a relay cut by a manual override or the balance gate beeped nothing
 *  at all. A plain before/after comparison catches every case in one place
 *  with no risk of double-beeping (each writer only runs once per cycle).
 * -------------------------------------------------------------------------*/
void checkRelayTransitions() {
  for (uint8_t i = 0; i < 4; i++) {
    if (prevRelayState[i] && !relayState[i]) beepCutoff(i);
    prevRelayState[i] = relayState[i];
  }
}

/* ===========================================================================
 *  SECTION 6 — DEVICE IDENTITY
 * ===========================================================================*/
// Not needed for correctness any more (see makeDeviceID() below), kept only
// as a documented emergency escape hatch. Leave blank ("") on every board.
#define DEVICE_ID_OVERRIDE ""

// WiFi.macAddress() calls esp_netif_get_mac() internally, which requires
// the STA network interface to already exist -- if it doesn't (true here,
// since this runs before connectWiFi() ever calls WiFi.mode()), it fails
// silently and leaves the output buffer untouched. mac[] below was declared
// with no initializer, so on failure it held whatever garbage was already
// on the stack -- not a real MAC at all. That garbage was stable across
// reflashes of the *same* compiled binary (identical prior stack state
// each time), which is why it looked like a working, board-specific ID for
// most of a session, until a routine recompile shifted the stack layout
// enough to change it. Confirmed on real hardware: `esptool read-mac`
// (queries the chip's ROM bootloader directly, no WiFi driver involved)
// returned a completely different, correct MAC on the same board that this
// function had been reporting a stable-but-wrong ID for.
// esp_base_mac_addr_get() reads the factory-burned base MAC straight from
// eFuse -- no WiFi/netif state required, so no such failure mode exists.
String makeDeviceID() {
  if (strlen(DEVICE_ID_OVERRIDE) > 0) return String(DEVICE_ID_OVERRIDE);
  uint8_t mac[6] = {0};
  esp_base_mac_addr_get(mac);
  char b[7];
  snprintf(b, sizeof(b), "%02X%02X%02X", mac[3], mac[4], mac[5]);
  return String(b);
}

/* ===========================================================================
 *  SECTION 6b — WALL CLOCK
 *  cycleStartedAt (below) is a unix timestamp, so deciding whether a cycle
 *  is overdue needs real time. The ESP32 has no battery-backed clock, so
 *  it's taken from NTP. Timestamps WRITTEN to the database still use
 *  Firebase's own server sentinel, which stays authoritative regardless of
 *  whether this sync ever succeeds.
 * ===========================================================================*/
// Non-blocking -- configTzTime() just starts ESP-IDF's SNTP client, which
// syncs (and keeps itself resynced afterward) in the background. Called
// once from loop() after wifiUp is first confirmed true, not from setup();
// see the top-of-file changelog for why setup() is the wrong place. WAT-1 =
// West Africa Time, UTC+1, no DST -- correct for where these meters sit.
void initClock() {
  configTzTime("WAT-1", "pool.ntp.org", "time.nist.gov");
  Serial.println("[NTP] sync requested");
}

// Returns 0 when the clock hasn't synchronised yet.
uint64_t unixMillis() {
  time_t now = time(nullptr);
  if (now < 1700000000UL) return 0;
  return (uint64_t)now * 1000ULL;
}

/* ===========================================================================
 *  SECTION 7 — NON-VOLATILE STORAGE
 * ===========================================================================*/
void loadNVS() {
  prefs.begin("energitoken", true);
  budget.totalWh    = prefs.getFloat("bWh",  0.0f);
  budget.baselineWh = prefs.getFloat("base", 0.0f);
  budget.days        = prefs.getUInt("days", DEFAULT_PERIOD_DAYS);
  budget.budgetSet   = prefs.getBool("bset", false);
  budget.baselineSet = prefs.getBool("blset", false);
  budget.cycleStartedAt = prefs.getULong64("cyc", 0ULL);
  budget.budgetClearedAt = prefs.getULong64("bclr", 0ULL);
  tokenBal      = prefs.getFloat("tBal", 0.0f);
  tokenBalKnown = prefs.getBool("tKnown", false);
  prefs.end();

  Serial.printf("[NVS] budgetWh=%.0f baseline=%.0f budgetSet=%d baselineSet=%d\n",
                budget.totalWh, budget.baselineWh,
                budget.budgetSet, budget.baselineSet);
  Serial.printf("[NVS] cycleStartedAt=%llu\n", (unsigned long long)budget.cycleStartedAt);
  Serial.printf("[NVS] tokenBal=%.0f tokenBalKnown=%d\n", tokenBal, tokenBalKnown);
}
void saveNVS() {
  prefs.begin("energitoken", false);
  prefs.putFloat("bWh",  budget.totalWh);
  prefs.putFloat("base", budget.baselineWh);
  prefs.putUInt("days",  budget.days);
  prefs.putBool("bset",  budget.budgetSet);
  prefs.putBool("blset", budget.baselineSet);
  prefs.putULong64("cyc", budget.cycleStartedAt);
  prefs.putULong64("bclr", budget.budgetClearedAt);
  prefs.putFloat("tBal", tokenBal);
  prefs.putBool("tKnown", tokenBalKnown);
  prefs.end();
}

// Overwrites the WIFI_SSID/WIFI_PASSWORD defaults with whatever was last
// saved through the setup portal, if anything was ever saved. Left alone
// (defaults stand) on a board that's never been through setup.
void loadWiFiCreds() {
  prefs.begin("energitoken", true);
  String s = prefs.getString("wssid", "");
  String p = prefs.getString("wpass", "");
  prefs.end();
  if (s.length() > 0) {
    s.toCharArray(WIFI_SSID, sizeof(WIFI_SSID));
    p.toCharArray(WIFI_PASSWORD, sizeof(WIFI_PASSWORD));
    Serial.println("[NVS] using saved WiFi network: " + s);
  }
}

void saveWiFiCreds(const String& ssid, const String& pass) {
  prefs.begin("energitoken", false);
  prefs.putString("wssid", ssid);
  prefs.putString("wpass", pass);
  prefs.end();
}

/* ===========================================================================
 *  SECTION 8 — RELAY CONTROL
 * ===========================================================================*/
void setRelay(uint8_t i, bool closed) {
  if (i > 3) return;
  relayState[i] = closed;
  digitalWrite(RELAY_PINS[i], closed ? RELAY_CLOSED : RELAY_OPEN);
}
// Called from setup() AFTER loadNVS() and the balanceGated derivation that
// follows it (see setup() below), specifically so this can check the real,
// persisted answer instead of always assuming "nothing is interrupted at
// boot". A household already gated off for zero credit would otherwise get
// full power, including the critical tier, for the entire boot sequence --
// worst case ~38s (WiFi timeout + Firebase auth + first config pull) before
// applyBalanceGate() ever gets a chance to run and correct it.
// Every relay starts OFF, full stop -- not "on unless last known balance
// says otherwise". The previous version used the balance persisted in NVS
// (see setup()) to decide the very first digitalWrite(), which correctly
// covered a board that was already gated off, but still optimistically
// turned everything on for a board that merely *looked* fine last time it
// checked -- and that NVS snapshot could be stale (spent from the app
// while the meter was powered off, budget exhausted overnight, etc.).
// Relays only come back on once the real, fresh check has actually run:
// applyBalanceGate()/runAlgorithm() on their normal loop() timers, once
// WiFi/Firebase has confirmed the household's real current state.
void initRelays() {
  for (uint8_t i = 0; i < 4; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    setRelay(i, false);
  }
}

/* ===========================================================================
 *  SECTION 9 — PZEM MEASUREMENT
 * ===========================================================================*/
bool readPZEM() {
  float v = pzem.voltage(), i = pzem.current();
  float p = pzem.power(),   e = pzem.energy();      // library returns kWh
  float f = pzem.frequency(), pf = pzem.pf();

  if (isnan(v) || isnan(i) || isnan(p) || isnan(e)) {
    meas.valid = false;
    return false;
  }
  meas.voltage = v * VOLTAGE_CAL_FACTOR;   // corrected against a multimeter reference, see the #define above
  meas.current = i;
  meas.power   = p;
  meas.energy  = e * 1000.0f;                       // kWh -> Wh
  meas.freq    = isnan(f)  ? 0 : f;
  meas.pf      = isnan(pf) ? 0 : pf;
  meas.valid   = true;
  return true;
}

/* ===========================================================================
 *  SECTION 10 — BUDGET ALGORITHM WITH PRIORITY LOAD SHEDDING
 *
 *    Ec   = Et - E0                          (Eq 3.1)
 *    beta = (Ec / B) * 100                   (Eq 3.2)
 *    shed    when beta >= t[k]                (Eq 3.3)
 *    restore when beta <  t[k] - h            (Eq 3.4)
 * ===========================================================================*/
void evalChannel(uint8_t idx, float shedPoint) {
  // A manually overridden channel is applyOverrides()'s alone to decide --
  // otherwise this runs on its own 2s timer, sees the override's relay
  // state as "wrong" against the budget threshold, and restores/sheds it
  // right back, which applyOverrides() (500ms timer) then corrects again:
  // the exact fighting-writers oscillation the balance gate already had to
  // be protected from above, just with overrides as the second writer.
  if (overridePresent[idx]) return;

  float restorePoint = shedPoint - HYSTERESIS;

  if (budget.percent >= shedPoint && relayState[idx]) {
    setRelay(idx, false);
    // No beep here -- see checkRelayTransitions() in the main loop, which
    // beeps on any on->off transition regardless of what caused it (this
    // shed, a manual override, or the balance gate), instead of only the
    // threshold-crossing case this used to cover alone.
    Serial.printf("[SHED]    %s  beta=%.2f%%\n", TIER_NAME[idx], budget.percent);
  }
  else if (budget.percent < restorePoint && !relayState[idx]) {
    setRelay(idx, true);
    Serial.printf("[RESTORE] %s  beta=%.2f%%\n", TIER_NAME[idx], budget.percent);
  }
}

void applyOverrides() {
  // The gate is authoritative at zero balance -- an override closing a
  // relay the gate just opened, then the gate reopening it again, is the
  // same fighting-writers bug as runAlgorithm() below, just with a
  // different second writer. Overriding while genuinely at zero credit is
  // deliberately impossible; it works exactly as before at any positive
  // balance.
  if (balanceGated) return;
  for (uint8_t i = 0; i < 4; i++) {
    if (!overridePresent[i]) continue;          // no key means auto
    bool want = overrideValue[i];
    // Critical can still never be forced OFF by an override -- that's a
    // stray-tap safety net, not a statement that critical never sheds
    // (it now does, via evalChannel(0, THRESH_R1) below, once the
    // household's own budget hits 100%). An override CAN bring critical
    // back on after that happens, same as any other tier.
    if (i == 0 && !want) want = true;
    if (relayState[i] != want) setRelay(i, want);
  }
}

/* ---------------------------------------------------------------------------
 *  Zero/unknown-balance gate: with no *confirmed* purchased credit, nothing
 *  runs, including critical. Critical also sheds via the household's own
 *  budget now (evalChannel(0, THRESH_R1) in runAlgorithm(), at 100% used) --
 *  but that's a *self-chosen* limit the household can override past (an app
 *  override can still bring critical back on, spending from balance outside
 *  today's budgeted allowance). This gate is different: it fires only when
 *  there's no confirmed purchased credit at all, and nothing -- not even an
 *  override -- can bring anything back on until that changes.
 *
 *  Fails CLOSED, deliberately: gated whenever tokenBalKnown is false, not
 *  just when a confirmed reading is <= 0. A board that's never synced a
 *  real balance -- brand new, just reflashed, NVS erased -- gets no power
 *  at all until Firebase actually confirms it has some, rather than
 *  assuming the best in the meantime. NVS persistence (see loadNVS()) is
 *  what keeps this from re-gating on every ordinary reboot: a board that
 *  already confirmed a positive balance before a power cycle still has
 *  tokenBalKnown=true and the real tokenBal restored from flash, so this
 *  only actually bites on a board's first-ever sync or after its NVS is
 *  wiped, not on routine reboots.
 *
 *  This sets balanceGated rather than just acting once -- runAlgorithm()
 *  and applyOverrides() both check that flag and stand down while it's
 *  set. An earlier version had all three functions writing relayState
 *  independently on different timers (this one every 500ms, runAlgorithm
 *  every 2s): at zero balance, budget.percent reads 0, which satisfies
 *  every tier's *restore* condition, so runAlgorithm() would close every
 *  relay this function had just opened, and this function would reopen
 *  them again 500ms later -- roughly 1800 open-close cycles/hour, audible
 *  and mechanically damaging, exactly the wear the hysteresis band exists
 *  to prevent. The flag makes this the sole writer at zero balance instead
 *  of the fastest of three competing ones.
 *
 *  Full precedence, called in this order from loop():
 *    1. Balance unknown or <= 0   -> this gate: everything off, absolute
 *    2. Balance confirmed positive, override set -> applyOverrides() wins
 *    3. Balance confirmed positive, no override -> runAlgorithm() thresholds
 *       (including critical, at 100% of the household's own budget)
 * -------------------------------------------------------------------------*/
/* ---------------------------------------------------------------------------
 *  Clears every manual relay override, locally and in Firebase. Shared by
 *  applyBalanceGate() (fires the moment the household newly runs out of
 *  credit) and pullConfig()'s budgetClearedAt handling (fires on an
 *  explicit budget reset) -- same reasoning both times: a stale "forced
 *  on/off" override from before the triggering event would otherwise
 *  silently reassert itself instead of the household actually starting
 *  clean.
 * -------------------------------------------------------------------------*/
void clearAllOverrides() {
  for (uint8_t i = 0; i < 4; i++) { overridePresent[i] = false; overrideValue[i] = false; }
  if (wifiUp && fbReady && Firebase.ready()) {
    String path = "/meters/" + deviceID + "/relayOverrides";
    if (!Firebase.RTDB.deleteNode(&fbdo, path.c_str()))
      Serial.println("Override clear failed: " + fbdo.errorReason());
  }
}

void applyBalanceGate() {
  bool wasGated = balanceGated;
  balanceGated = (!tokenBalKnown || tokenBal <= 0);

  // Newly gated (not just still gated from last cycle): clear every manual
  // override. Otherwise a stale "forced on" override from before the
  // household ran out of credit would silently reassert itself the instant
  // balance is restored, bypassing whatever shedding state the household
  // should actually start the new credit at.
  if (balanceGated && !wasGated) clearAllOverrides();

  if (!balanceGated) return;
  for (uint8_t i = 0; i < 4; i++) {
    if (relayState[i]) setRelay(i, false);
  }
}

void runAlgorithm() {
  if (!meas.valid) return;
  if (balanceGated) return;   // no purchased credit: the gate owns the relays, not this

  // Capture a baseline only when none exists. A baseline restored from
  // flash by loadNVS() is authoritative and must survive a power cut,
  // otherwise progress through the current cycle is lost on every reboot
  // and the shedding thresholds are then evaluated against a wrong figure.
  // baselineSet is persisted precisely so that this stays true across boots.
  if (!budget.baselineSet) {
    budget.baselineWh  = meas.energy;
    budget.baselineSet = true;
    saveNVS();
    Serial.printf("[BASE] first baseline captured at %.0f Wh\n",
                  budget.baselineWh);
  }

  // energyWh for THIS budget cycle: sensor lifetime total minus the
  // baseline captured when the cycle began.
  budget.cycleWh = meas.energy - budget.baselineWh;
  if (budget.cycleWh < 0) budget.cycleWh = 0;

  // percentUsed = energyWh / budgetWh * 100
  budget.percent = (budget.totalWh > 0)
                 ? (budget.cycleWh / budget.totalWh) * 100.0f
                 : 0.0f;

  evalChannel(3, THRESH_R4);      // luxury first
  evalChannel(2, THRESH_R3);
  evalChannel(1, THRESH_R2);
  evalChannel(0, THRESH_R1);      // critical sheds last, only once the household's own budget is fully used

  // applyOverrides()/applyBalanceGate() are NOT called here on purpose --
  // they run on their own timer in loop(), independent of PZEM validity.
  // Calling them only from inside this function (gated on `if (!meas.valid)
  // return;` above) was a real bug: a loose sensor lead would silently
  // freeze both manual overrides and the zero-balance gate along with the
  // budget algorithm, even though neither has anything to do with whether
  // the current sensor is answering.
}

/* ---------------------------------------------------------------------------
 *  Begin a new budget cycle.
 *  Recaptures the baseline so energyWh restarts at zero against the current
 *  allowance. Relays that had shed restore on the next evaluation pass,
 *  since percentUsed is now below every restore threshold.
 * -------------------------------------------------------------------------*/
void startNewCycle(uint64_t stamp, const char* reason) {
  budget.cycleStartedAt = stamp;
  if (meas.valid) {
    budget.baselineWh  = meas.energy;
    budget.baselineSet = true;
  }
  budget.cycleWh  = 0;
  budget.percent  = 0;
  cycleLocalStart = millis();
  saveNVS();
  Serial.printf("[CYCLE] %s  stamp=%llu baseline=%.0f\n",
                reason, (unsigned long long)stamp, budget.baselineWh);
}

/* ---------------------------------------------------------------------------
 *  Local fallback. If no cycle signal has arrived from the app/cron for
 *  longer than the grace period, roll the cycle on this device instead.
 *  budgetWh is a daily allowance, so rolling locally grants exactly one
 *  further day, which is the correct behaviour -- this keeps a late or
 *  failed cron from stranding the household at critical-only indefinitely.
 * -------------------------------------------------------------------------*/
bool cycleOverdue() {
  if (!budget.budgetSet) return false;          // nothing to roll yet

  uint64_t now = unixMillis();
  if (now > 0 && budget.cycleStartedAt > 0)
    return (now - budget.cycleStartedAt) >= CYCLE_GRACE_MS;

  // No wall clock yet: fall back to time elapsed on this device since the
  // last cycle began. Unsigned subtraction handles millis() rollover.
  return (uint64_t)(millis() - cycleLocalStart) >= CYCLE_GRACE_MS;
}

void checkCycleFallback() {
  if (!cycleOverdue()) return;
  uint64_t now = unixMillis();
  startNewCycle(now > 0 ? now : budget.cycleStartedAt + CYCLE_GRACE_MS,
                "local fallback roll");
}

/* ---------------------------------------------------------------------------
 *  Mirrors a locally-triggered cycle reset back to Firebase, so the app's
 *  Budget page reflects the real cycle-start time instead of a stale value
 *  from the last cron tick. Best-effort: a failed write here doesn't undo
 *  the reset that already happened locally on this device, it just leaves
 *  the app's copy stale until the next successful write (the next
 *  NTP-driven reset, or the daily cron overwriting it anyway).
 * -------------------------------------------------------------------------*/
void publishCycleStartedAt(uint64_t stamp) {
  if (!(wifiUp && fbReady && Firebase.ready())) return;
  String path = "/meters/" + deviceID + "/cycleStartedAt";
  if (!Firebase.RTDB.setDouble(&fbdo, path.c_str(), (double)stamp))
    Serial.println("cycleStartedAt publish failed: " + fbdo.errorReason());
}

/* ---------------------------------------------------------------------------
 *  Precise local-midnight cycle reset. Cheap enough (a few field reads plus
 *  an int compare) to check every loop() pass, so it actually fires within
 *  a second or two of true local midnight -- unlike checkCycleFallback()'s
 *  millis()-based path above, which only guarantees "within CYCLE_GRACE_MS
 *  of the last signal" and can land at essentially any time of day. This is
 *  the primary mechanism once NTP is synced; checkCycleFallback() keeps
 *  covering things exactly as before for a meter that never gets sync at
 *  all (no WiFi, blocked NTP ports, etc.).
 * -------------------------------------------------------------------------*/
void checkLocalMidnight() {
  time_t now = time(nullptr);
  if (now < 1700000000UL) return;   // not synced yet -- defer to the fallback above

  struct tm tmNow;
  localtime_r(&now, &tmNow);

  if (lastSeenYday < 0) {
    lastSeenYday = tmNow.tm_yday;    // first sync this boot -- record only, don't reset mid-day
    return;
  }
  if (tmNow.tm_yday == lastSeenYday) return;

  lastSeenYday = tmNow.tm_yday;
  if (!budget.budgetSet) return;     // nothing to roll if no budget is set yet

  uint64_t stamp = (uint64_t)now * 1000ULL;
  startNewCycle(stamp, "local midnight (NTP)");
  publishCycleStartedAt(stamp);
}

/* ===========================================================================
 *  SECTION 11 — DISPLAY
 * ===========================================================================*/
void lcdBoot() {
  lcd.clear();
  lcd.setCursor(0,0); lcd.print("EnergiToken v2.0");
  lcd.setCursor(0,1); lcd.print("Device ID: "); lcd.print(deviceID);
  lcd.setCursor(0,2); lcd.print("Connecting WiFi...");
  lcd.setCursor(0,3); lcd.print("Please wait");
}

void lcdBar(float pct) {
  // 8 cells + 2 brackets = 10 chars; label is 10 chars; row totals 20.
  int n = (int)((pct / 100.0f) * 8.0f);
  if (n < 0) n = 0;
  if (n > 8) n = 8;
  lcd.print('[');
  for (int i = 0; i < 8; i++) lcd.print(i < n ? (char)255 : ' ');
  lcd.print(']');
}

void lcdLive() {
  char l[21];
  // Two spare columns on the right carry a stale marker once the sensor's
  // stopped answering -- without it the display just keeps showing the
  // last good reading forever, indistinguishable from a live one.
  lcd.setCursor(0,0);
  bool stale = (pzemFailCount >= PZEM_STALE_COUNT);
  snprintf(l, sizeof(l), "V:%5.1f I:%5.2f %s",
           meas.voltage, meas.current, stale ? "!!" : "  ");
  lcd.print(l);

  lcd.setCursor(0,1);
  snprintf(l, sizeof(l), "P:%5.0fW E:%6.0fWh", meas.power, budget.cycleWh);
  lcd.print(l);

  lcd.setCursor(0,2);
  snprintf(l, sizeof(l), "Bud:%5.1f%%", budget.percent);
  lcd.print(l);
  lcdBar(budget.percent);

  lcd.setCursor(0,3);
  for (uint8_t i = 0; i < 4; i++) {
    lcd.print((char)('1' + i));
    lcd.print(':');
    lcd.print(relayState[i] ? "ON " : "OFF");
  }
}

void lcdMenu() {
  lcd.clear();
  lcd.setCursor(0,0); lcd.print("== MENU ==");
  for (int r = 0; r < 3; r++) {
    int it = menuIdx + r;
    if (it >= MENU_N) break;
    lcd.setCursor(0, r+1);
    lcd.print(it == menuIdx ? '>' : ' ');
    lcd.print(MENU[it]);
  }
}

void lcdDays() {
  lcd.clear();
  lcd.setCursor(0,0); lcd.print("Set budget days");
  lcd.setCursor(0,1); lcd.print("Days: "); lcd.print(inputDays);
  lcd.setCursor(0,2);
  if (budget.totalWh > 0 && inputDays > 0) {
    lcd.print("Daily: ");
    lcd.print(budget.totalWh / (float)inputDays, 1);
    lcd.print("Wh");
  }
  lcd.setCursor(0,3); lcd.print("UP/DN   ENT=save");
}

void lcdRelays() {
  lcd.clear();
  lcd.setCursor(0,0); lcd.print("Relay states");
  for (uint8_t i = 0; i < 3; i++) {
    lcd.setCursor(0, i+1);
    lcd.print((char)('1'+i)); lcd.print(' ');
    lcd.print(TIER_NAME[i]);
    lcd.setCursor(15, i+1);
    lcd.print(relayState[i] ? "ON " : "OFF");
    if (overridePresent[i]) { lcd.setCursor(19, i+1); lcd.print('*'); }
  }
}

void lcdBalance() {
  lcd.clear();
  lcd.setCursor(0,0); lcd.print("Token balance");
  lcd.setCursor(0,1); lcd.print(tokenBal, 0); lcd.print(" ENGY");
  lcd.setCursor(0,2); lcd.print("= "); lcd.print(tokenBal, 0); lcd.print(" Wh");
  lcd.setCursor(0,3); lcd.print(wifiUp ? "Synced" : "Offline - cached");
}

// Shown in place of the live screen for a few seconds after a top-up is
// detected (see pullConfig()) -- doesn't touch `ui`, so whatever screen the
// household was actually on resumes automatically once topUpNoticeUntil
// passes, the same way the pairing-confirmation screen behaves.
void lcdTopUpNotice() {
  char l[21];
  lcd.setCursor(0,0); lcd.print("   TOP UP RECEIVED  ");
  lcd.setCursor(0,1);
  snprintf(l, sizeof(l), "     +%.0f ENGY", lastTopUpAmount);
  lcd.print(l);
  lcd.setCursor(0,2); lcd.print("   New balance:");
  lcd.setCursor(0,3);
  snprintf(l, sizeof(l), "     %.0f ENGY", tokenBal);
  lcd.print(l);
}

void lcdDeviceId() {
  lcd.clear();
  lcd.setCursor(0,0); lcd.print("Device ID:");
  lcd.setCursor(0,1); lcd.print(deviceID);
  lcd.setCursor(0,2); lcd.print("Enter in the app");
  lcd.setCursor(0,3); lcd.print("BACK = exit");
}

void lcdPairing() {
  lcd.clear();
  lcd.setCursor(0,0); lcd.print("PAIRING MODE");
  lcd.setCursor(0,1); lcd.print("ID: "); lcd.print(deviceID);
  uint32_t leftMin = (PAIR_WINDOW_MS - (millis() - pairingStart)) / 60000UL;
  lcd.setCursor(0,2); lcd.print("Open in "); lcd.print(leftMin); lcd.print(" min");
  lcd.setCursor(0,3); lcd.print("BACK = cancel");
}

void lcdRefresh() {
  switch (ui) {
    case UI_LIVE:   lcdLive();     break;
    case UI_MENU:   lcdMenu();     break;
    case UI_DAYS:   lcdDays();     break;
    case UI_RELAYS: lcdRelays();   break;
    case UI_BAL:    lcdBalance();  break;
    case UI_ID:     lcdDeviceId(); break;
    case UI_PAIR:   lcdPairing();  break;
  }
}

/* ===========================================================================
 *  SECTION 12 — PAIRING MODE
 *  Publishes the device ID to a pending-pairing node with a one-hour expiry.
 *  Entered by holding ENTER for three seconds from the live screen.
 * ===========================================================================*/
void startPairing() {
  pairingActive = true;
  pairingStart  = millis();
  tPairBeep     = millis();   // heartbeat's first tick lands ~1s from now, not immediately
  ui            = UI_PAIR;
  beepPair();

  if (fbReady && Firebase.ready()) {
    // The backend device-claim endpoint reads /pendingDevices only.
    String path = "/pendingDevices/" + deviceID;
    FirebaseJson j;
    j.set("createdAt/.sv", "timestamp");     // server-resolved unix ms
    if (!Firebase.RTDB.setJSON(&fbdo, path.c_str(), &j))
      Serial.println("Pairing publish failed: " + fbdo.errorReason());
    else
      Serial.println("Pairing published at /pendingDevices/" + deviceID);
  }
  lcdRefresh();
}

void stopPairing() {
  pairingActive = false;
  if (fbReady && Firebase.ready())
    Firebase.RTDB.deleteNode(&fbdo, ("/pendingDevices/" + deviceID).c_str());
  ui = UI_LIVE;
  lcd.clear();
  lcdRefresh();
}

// Called once, the moment a successful claim is detected. Deliberately does
// NOT delete /pendingDevices/{deviceId} the way a manual cancel does -- the
// backend already wrote claimed/claimedAt/claimedByWallet into that node as
// part of claiming it, and that record should survive, not get wiped by us.
void showPairedConfirmation() {
  pairingActive = false;
  lcd.clear();
  lcd.setCursor(0,0); lcd.print("PAIRED!");
  lcd.setCursor(0,1); lcd.print("ID: "); lcd.print(deviceID);
  lcd.setCursor(0,2); lcd.print("Linked to your");
  lcd.setCursor(0,3); lcd.print("EnergiToken account");
  beepTopUp();      // reuse the existing "success" chime
  delay(2500);      // brief, deliberate pause so the confirmation is actually seen
  ui = UI_LIVE;
  lcd.clear();
  lcdRefresh();
}

// Polled every PAIR_CHECK_MS while pairingActive is true. This is what makes
// pairing mode exit on its own the moment the app finishes claiming the
// device, instead of sitting on the countdown screen until BACK is pressed
// or the full hour expires with no feedback either way.
void checkPairingClaimed() {
  if (!fbReady || !Firebase.ready()) return;
  if (Firebase.RTDB.getBool(&fbdo, ("/pendingDevices/" + deviceID + "/claimed").c_str())) {
    if (fbdo.boolData()) {
      Serial.println("Pairing confirmed: claimed by app.");
      showPairedConfirmation();
    }
  }
}

/* ===========================================================================
 *  SECTION 13 — KEYPAD
 *  Real 4x3 matrix, only two rows wired (ROW1=1,2,3 / ROW4=*,0,#). The
 *  Keypad library scans it and handles debounce; setHoldTime() below makes
 *  its own PRESSED/HOLD/RELEASED states line up with PAIR_HOLD_MS so # held
 *  for 3 s on the live screen is what used to be the long-press-ENTER check.
 * ===========================================================================*/
void commitDays() {
  // Local display duration only. It is deliberately NOT written to the
  // database, and it must not set budgetSet or baselineSet: the budget
  // cycle belongs to the app's budgetWh, not to this on-device menu.
  budget.days = inputDays;
  saveNVS();
  beepTopUp();
}

void handleKeys() {
  // getKey()'s return value is deliberately NOT used for the state-based
  // logic below -- per the library's own source, it only ever returns a
  // char when key[0].kstate==PRESSED, never on HOLD or RELEASED. Calling it
  // still runs the scan (its real side effect); key[0] itself, read
  // directly, is what actually reflects the current state reliably.
  kpd.getKey();
  char     key     = kpd.key[0].kchar;
  KeyState state    = kpd.key[0].kstate;
  bool     changed  = kpd.key[0].stateChanged;

  if (key == NO_KEY || state == IDLE) return;

  // '#' on the live screen is ambiguous on purpose: a short tap means enter
  // the menu, a 3 s hold means start pairing, and there's no way to know
  // which one it'll be at the moment it's first pressed. So it can't be
  // handled by the generic "act on PRESSED" path below like every other
  // key -- committing to "enter menu" on the very first PRESSED event would
  // move ui off UI_LIVE immediately, and by the time the hold actually
  // completed a few seconds later, the pairing check (which requires still
  // being on UI_LIVE) would never pass. Handled entirely by its own
  // HOLD/RELEASED transitions instead, PRESSED is only used for the beep.
  // `changed` gates every branch so each transition fires exactly once,
  // not on every loop pass while a state persists.
  if (ui == UI_LIVE && key == '#') {
    if (state == PRESSED && changed) {
      beepKey();     // audible confirmation the press registered at all
      return;
    }
    if (state == HOLD && changed && !pairingActive) {
      startPairing();
      return;
    }
    if (state == RELEASED && changed && !pairingActive) {
      // A short tap that never became a hold -- now it's safe to commit to
      // "enter menu", since we know for certain this wasn't a pairing hold.
      menuTouch = millis();
      ui = UI_MENU;
      menuIdx = 0;
      lcd.clear();
      lcdRefresh();
    }
    return;
  }

  // Only act on a fresh press -- ignore HOLD repeats and the RELEASED event,
  // same single-fire-per-press behaviour the old digitalRead code had via
  // its manual debounce timer, now handled by the library instead.
  if (state != PRESSED || !changed) return;

  menuTouch = millis();
  beepKey();

  bool up  = (key == '1');
  bool dn  = (key == '2');
  bool ent = (key == '#');
  bool bk  = (key == '*');

  switch (ui) {
    case UI_LIVE:
      if (ent) { ui = UI_MENU; menuIdx = 0; }
      if (key == '3') { ui = UI_ID; }    // shortcut: straight to Device ID
      if (key == '0') { ui = UI_BAL; }   // shortcut: straight to balance
      break;

    case UI_MENU:
      if (up) menuIdx = (menuIdx + MENU_N - 1) % MENU_N;
      if (dn) menuIdx = (menuIdx + 1) % MENU_N;
      if (bk) ui = UI_LIVE;
      if (ent) {
        switch (menuIdx) {
          case 0: inputDays = budget.days; ui = UI_DAYS; break;
          case 1: ui = UI_RELAYS; break;
          case 2: ui = UI_BAL;    break;
          case 3: ui = UI_ID;     break;
        }
      }
      break;

    case UI_DAYS:
      if (up) inputDays++;
      if (dn && inputDays > 1) inputDays--;
      if (bk) ui = UI_MENU;
      if (ent) { commitDays(); ui = UI_LIVE; }
      break;

    case UI_PAIR:
      if (bk) { stopPairing(); return; }
      break;

    default:                       // UI_RELAYS, UI_BAL, UI_ID
      if (bk || ent) ui = UI_MENU;
      break;
  }

  lcd.clear();
  lcdRefresh();
}

/* ===========================================================================
 *  SECTION 14 — NETWORK
 * ===========================================================================*/

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < WIFI_TIMEOUT_MS) {
    delay(400); Serial.print('.');
  }
  wifiUp = (WiFi.status() == WL_CONNECTED);

  lcd.setCursor(0,2);
  if (wifiUp) {
    lcd.print("WiFi OK             ");
    lcd.setCursor(0,3); lcd.print(WiFi.localIP().toString());
    Serial.println("\nWiFi " + WiFi.localIP().toString());
  } else {
    lcd.print("WiFi failed         ");
    lcd.setCursor(0,3); lcd.print("Offline mode        ");
    Serial.println("\nWiFi failed, running offline");
  }
  // No trailing delay -- it existed only so the IP/status was readable on
  // the LCD, and the live screen replaces this view a second later anyway.
}

void initFirebase() {
  if (!wifiUp) return;
  fbCfg.database_url = FB_HOST;
  fbCfg.signer.tokens.legacy_token = FB_SECRET;   // device credential
  Firebase.begin(&fbCfg, &fbAuth);
  Firebase.reconnectWiFi(true);
  fbReady = true;
}

// Signs "deviceID:energyWhInt" with this board's own HMAC key and returns
// the 64-char lowercase hex digest the oracle re-derives and compares. Only
// energyWhInt is signed -- that's the one field that actually reaches
// burnConsumed/setPendingBurn, so it's the one field worth a signature the
// shared FB_SECRET credential can't forge on its own. An integer input
// (rather than the display float) means both sides format it identically:
// no floating-point-to-string mismatch to worry about between this C++ and
// the oracle's JS.
String signEnergyReading(uint32_t energyWhInt) {
  uint8_t key[32];
  for (int i = 0; i < 32; i++) {
    char byteStr[3] = { METER_HMAC_KEY_HEX[i * 2], METER_HMAC_KEY_HEX[i * 2 + 1], 0 };
    key[i] = (uint8_t)strtol(byteStr, nullptr, 16);
  }

  String msg = deviceID + ":" + String(energyWhInt);
  uint8_t digest[32];

  mbedtls_md_context_t ctx;
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, info, 1 /* HMAC */);
  mbedtls_md_hmac_starts(&ctx, key, sizeof(key));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)msg.c_str(), msg.length());
  mbedtls_md_hmac_finish(&ctx, digest);
  mbedtls_md_free(&ctx);

  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + i * 2, "%02x", digest[i]);
  hex[64] = '\0';
  return String(hex);
}

void pushState() {
  if (!fbReady || !Firebase.ready()) return;

  // Exactly the fields the firmware owns. budgetWh and relayOverrides are
  // read-only here and must never appear in this payload.
  uint32_t energyWhInt = (uint32_t)(budget.cycleWh > 0 ? budget.cycleWh : 0);

  FirebaseJson j;
  j.set("voltage",     meas.voltage);      // V
  j.set("current",     meas.current);      // A
  j.set("power",       meas.power);        // W
  j.set("frequency",   meas.freq);         // Hz
  j.set("powerFactor", meas.pf);           // 0..1
  j.set("energyWh",    budget.cycleWh);    // Wh, current budget cycle only (display)
  j.set("energyWhInt", energyWhInt);       // Wh, same value floored -- what's actually signed
  j.set("sig",         signEnergyReading(energyWhInt));
  j.set("percentUsed", budget.percent);    // 0..100
  j.set("relays/r1",   relayState[0]);
  j.set("relays/r2",   relayState[1]);
  j.set("relays/r3",   relayState[2]);
  j.set("relays/r4",   relayState[3]);
  j.set("updatedAt/.sv", "timestamp");     // server-resolved unix ms

  String path = "/meters/" + deviceID;
  if (!Firebase.RTDB.updateNode(&fbdo, path.c_str(), &j))
    Serial.println("Push failed: " + fbdo.errorReason());
}

void pullConfig() {
  if (!fbReady || !Firebase.ready()) return;
  String base = "/meters/" + deviceID;

  // One request for everything below, instead of the 6 separate blocking
  // round-trips this used to make (budgetWh, tokenBalance, 4x
  // relayOverrides). At FB_PULL_MS this fast (2s, see Section 2), 6
  // sequential blocking network calls per cycle starved the main loop badly
  // enough that keypad presses got scanned late or mid-transition -- a
  // press would eventually beep once the loop unblocked, but the actual
  // menu action was already lost. One combined read fixes it at the source
  // rather than backing off the poll rate.
  if (!Firebase.RTDB.getJSON(&fbdo, base.c_str())) return;
  FirebaseJson &json = fbdo.to<FirebaseJson>();
  FirebaseJsonData result;

  // budgetWh — READ ONLY. Set by the app's Budget screen.
  // Does NOT reset the cycle itself -- see cycleStartedAt below, which is
  // the sole reset trigger. Resetting here on every value change would miss
  // the household that keeps the exact same daily budget every day, which
  // is precisely the household budgeting correctly: without a separate
  // signal, that household's baseline would never re-capture and its
  // "cycle" would just run forever instead of rolling over daily.
  if (json.get(result, "budgetWh") && result.success) {
    float v = result.floatValue;
    if (v > 0) {
      bool changed = fabs(v - budget.totalWh) > 0.5f;
      if (changed || !budget.budgetSet) {
        bool topUp       = changed && (v > budget.totalWh);
        budget.totalWh   = v;
        budget.budgetSet = true;
        saveNVS();
        if (topUp) beepTopUp();
      }
    }
  }

  // cycleStartedAt — READ ONLY, unix ms. Written by the app on a plan
  // change and by the daily cron. This is the sole trigger for starting a
  // new budget cycle (see startNewCycle). Read as a double, not a float --
  // a unix-ms timestamp exceeds a 32-bit float's exact-integer range, and
  // FirebaseJsonData.doubleValue holds it exactly.
  if (json.get(result, "cycleStartedAt") && result.success) {
    uint64_t v = (uint64_t)result.doubleValue;
    if (v > 0 && v != budget.cycleStartedAt) startNewCycle(v, "signal from database");
  }

  // budgetClearedAt — READ ONLY, unix ms, edge-triggered exactly like
  // cycleStartedAt above. Written by /api/data's resetBudget action.
  // budgetWh itself can never signal "go back to unrestricted" (see its own
  // comment above), so this is the dedicated clear signal: drop back to no
  // budget set, and restore every relay via the same override-clear
  // applyBalanceGate() uses. The server writes a fresh cycleStartedAt in
  // the same request, so that block above already handles resetting
  // cycleWh/the baseline -- no need to duplicate that here.
  if (json.get(result, "budgetClearedAt") && result.success) {
    uint64_t v = (uint64_t)result.doubleValue;
    if (v > 0 && v != budget.budgetClearedAt) {
      budget.budgetClearedAt = v;
      budget.budgetSet = false;
      budget.totalWh   = 0;
      budget.percent   = 0;
      saveNVS();
      clearAllOverrides();
      Serial.println("[BUDGET] cleared -- back to unrestricted");
    }
  }

  // Token balance -- shown on the local balance screen, feeds the
  // zero-balance gate (Section 10), and drives the top-up notice below.
  if (json.get(result, "tokenBalance") && result.success) {
    float newBal = result.floatValue;

    // A meaningful increase over a previously-known balance means a top-up
    // landed -- epsilon avoids firing on float noise between two pulls that
    // read the same real value. Only fires once tokenBalKnown, so the very
    // first real reading a board ever sees (going from the 0 compile-time
    // default) doesn't get mistaken for a top-up.
    if (tokenBalKnown && newBal > tokenBal + 0.5f) {
      lastTopUpAmount  = newBal - tokenBal;
      topUpNoticeUntil = millis() + 4000UL;
      beep(500, 150, 2);   // loud, distinct from every other beep pattern in this firmware
    }

    // Going from zero (or unknown) credit to a positive balance restores
    // every tier immediately, rather than leaving the household waiting on
    // runAlgorithm()'s own poll cycle -- applyBalanceGate() would let them
    // back on eventually regardless, this just makes a top-up feel instant.
    if ((!tokenBalKnown || tokenBal <= 0) && newBal > 0) {
      for (uint8_t i = 0; i < 4; i++) setRelay(i, true);
    }

    // Persisted so a reboot isn't blind -- see the balanceGated derivation
    // in setup(), right after loadNVS(). Only writes flash on a genuine
    // change (or the very first real reading), not on every 2s poll that
    // happens to read the same value back.
    bool changed = !tokenBalKnown || fabs(newBal - tokenBal) > 0.5f;
    tokenBal      = newBal;
    tokenBalKnown = true;
    if (changed) saveNVS();
  }

  // relayOverrides — READ ONLY. Booleans written by the app.
  // A missing key means the tier runs on automatic thresholds.
  const char* okeys[4] = { "relayOverrides/r1", "relayOverrides/r2",
                           "relayOverrides/r3", "relayOverrides/r4" };
  for (uint8_t i = 0; i < 4; i++) {
    if (json.get(result, okeys[i]) && result.success) {
      overridePresent[i] = true;
      overrideValue[i]   = result.boolValue;
    } else {
      overridePresent[i] = false;          // absent, null, or unreadable
      overrideValue[i]   = false;
    }
  }
}

/* ===========================================================================
 *  SECTION 14b — RELAY OVERRIDE REALTIME STREAM
 *
 *  relayOverrides is the one field on this board's meter node where poll
 *  latency is actually user-visible: someone taps a load on/off in the app
 *  and expects to hear the relay click, not wait up to FB_PULL_MS (2s) plus
 *  OVERRIDE_APPLY_MS (500ms) for it to land. Everything else pullConfig()
 *  reads (budgetWh, cycleStartedAt, tokenBalance) is fine on that slower
 *  poll -- nobody's watching a top-up land in real time the way they watch
 *  a relay respond to their own tap.
 *
 *  Firebase's own realtime stream (beginStream/readStream) keeps a
 *  persistent connection open and fires the moment /relayOverrides changes,
 *  instead of waiting for the next timed poll. Deliberately NOT hand-parsing
 *  the stream's own put/patch delta payload here -- Firebase sends a full
 *  snapshot on connect and event-specific deltas after that, and getting
 *  that parsing subtly wrong on hardware I can't interactively test against
 *  is a worse risk than one extra small request. The stream is used purely
 *  as a "something changed, go check now" signal; pullOverridesNow() then
 *  re-reads with the exact same plain getJSON() + parse pullConfig() already
 *  uses above, just scoped to this one subpath.
 * ===========================================================================*/
void beginOverrideStream() {
  if (!wifiUp || !fbReady) return;
  String path = "/meters/" + deviceID + "/relayOverrides";
  if (Firebase.RTDB.beginStream(&ovStream, path.c_str()))
    Serial.println("[STREAM] override stream connected: " + path);
  else
    Serial.println("[STREAM] begin failed: " + ovStream.errorReason());
}

void pullOverridesNow() {
  if (!fbReady || !Firebase.ready()) return;
  String path = "/meters/" + deviceID + "/relayOverrides";
  if (!Firebase.RTDB.getJSON(&fbdo, path.c_str())) return;
  FirebaseJson &json = fbdo.to<FirebaseJson>();
  FirebaseJsonData result;
  const char* okeys[4] = { "r1", "r2", "r3", "r4" };
  for (uint8_t i = 0; i < 4; i++) {
    if (json.get(result, okeys[i]) && result.success) {
      overridePresent[i] = true;
      overrideValue[i]   = result.boolValue;
    } else {
      overridePresent[i] = false;
      overrideValue[i]   = false;
    }
  }
}

/* ===========================================================================
 *  SECTION 15 — SETUP
 * ===========================================================================*/
void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // initRelays() itself now starts every relay OFF unconditionally (see its
  // own comment) -- loadNVS() still has to run first regardless, so
  // balanceGated reflects the real persisted state by the time
  // applyBalanceGate() runs its first real check in loop(), rather than
  // comparing against the compile-time default and wrongly treating an
  // already-gated board as "newly" gated on every ordinary reboot.
  loadNVS();
  balanceGated = !tokenBalKnown || tokenBal <= 0;

  initRelays();
  // Match checkRelayTransitions()'s baseline to the real post-boot state,
  // not the compile-time default -- otherwise a board that boots already
  // gated (or with a stale override) would see every relay as "just cut
  // off" on its very first cycle and beep for all four at once.
  for (uint8_t i = 0; i < 4; i++) prevRelayState[i] = relayState[i];

  kpd.setHoldTime(PAIR_HOLD_MS);   // '#' held this long on the live screen = pairing
  kpd.setDebounceTime(50);         // library default is 10ms; membrane pads bounce 5-20ms

  Wire.begin(LCD_SDA_PIN, LCD_SCL_PIN);
  lcd.init();
  lcd.backlight();

  // Serial2 is opened by the PZEM004Tv30 constructor; do not begin it again.

  deviceID = makeDeviceID();
  Serial.println("\nEnergiToken v2.0  device " + deviceID);

  lcdBoot();
  beep(120, 0, 1);

  cycleLocalStart = millis();
  loadWiFiCreds();
  connectWiFi();
  // Still NOT calling initClock() here -- confirmed on real hardware that
  // configTime() this early in setup() hits a hard lwIP assertion
  // (udp_new_ip_type: "Required to lock TCPIP core functionality!") and
  // force-reboots the board, every cold boot. NTP is enabled now, just from
  // loop() instead (see the wifiUp check near the bottom of SECTION 16) --
  // by then setup() has fully finished and the network stack has had a lot
  // more time to settle than it has at this exact line.
  initFirebase();
  if (wifiUp) pullConfig();
  beginOverrideStream();

  lcd.clear();
  lcdRefresh();

  tPoll = tLcd = tPush = tPull = tCycle = tOverride = tOvStream = millis();
}

/* ===========================================================================
 *  SECTION 16 — MAIN LOOP
 * ===========================================================================*/
void loop() {
  uint32_t now = millis();

  handleKeys();

  // Pairing window expiry
  if (pairingActive && now - pairingStart >= PAIR_WINDOW_MS) stopPairing();

  // Idle menu timeout (pairing screen is exempt)
  if (ui != UI_LIVE && ui != UI_PAIR && now - menuTouch > MENU_TIMEOUT_MS) {
    ui = UI_LIVE;
    lcd.clear();
    lcdRefresh();
  }

  // Measurement and control
  if (now - tPoll >= POLL_MS) {
    tPoll = now;
    if (readPZEM()) {
      if (pzemFailCount >= PZEM_STALE_COUNT) Serial.println("[PZEM] recovered");
      pzemFailCount = 0;
      runAlgorithm();
    } else {
      if (pzemFailCount < 0xFFFF) pzemFailCount++;
      Serial.printf("PZEM read failed (%u consecutive)\n", pzemFailCount);
    }
  }

  // Manual overrides and the zero-balance gate, independent of PZEM
  // validity -- a loose sensor lead must not freeze either one.
  if (now - tOverride >= OVERRIDE_APPLY_MS) {
    tOverride = now;
    applyBalanceGate();   // must run first -- sets balanceGated, which applyOverrides() below checks
    applyOverrides();
  }

  // Every loop() iteration, cheap (four bool comparisons) -- catches a
  // cutoff from any writer (runAlgorithm on its own timer above, or
  // applyBalanceGate/applyOverrides on theirs), not tied to either timer.
  checkRelayTransitions();

  // Service the relayOverrides realtime stream -- fires pullOverridesNow()
  // the moment the app's change lands, rather than waiting for the next
  // FB_PULL_MS poll. streamTimeout() reconnects a dropped stream (Firebase
  // closes it periodically server-side; this is expected, not an error).
  if (wifiUp && fbReady && now - tOvStream >= OVSTREAM_CHECK_MS) {
    tOvStream = now;
    if (Firebase.RTDB.readStream(&ovStream)) {
      if (ovStream.streamAvailable()) {
        Serial.println("[STREAM] change: path=" + ovStream.dataPath() + " type=" + ovStream.dataType());
        pullOverridesNow();
      }
    } else {
      Serial.println("[STREAM] read error: " + ovStream.errorReason());
    }
    if (ovStream.streamTimeout()) {
      Serial.println("[STREAM] timed out, reconnecting");
      beginOverrideStream();
    }
  }

  // Local cycle fallback, evaluated whether or not the network is up.
  if (now - tCycle >= CYCLE_CHECK_MS) { tCycle = now; checkCycleFallback(); }

  // Precise local-midnight reset -- cheap, checked every pass so it fires
  // within a second or two of true midnight once NTP is synced.
  checkLocalMidnight();

  // While pairing, poll for a successful claim faster than the normal
  // config-pull interval, so the confirmation shows up promptly.
  if (pairingActive && wifiUp && now - tPairCheck >= PAIR_CHECK_MS) {
    tPairCheck = now;
    checkPairingClaimed();
  }

  // Audible heartbeat while pairing is active -- a short beep once a second
  // so it's obvious pairing mode is genuinely still running without having
  // to keep watching the LCD.
  if (pairingActive && now - tPairBeep >= PAIR_BEEP_MS) {
    tPairBeep = now;
    beep(40, 0, 1);
  }

  // Display
  if ((ui == UI_LIVE || ui == UI_PAIR) && now - tLcd >= LCD_MS) {
    tLcd = now;
    if (ui == UI_LIVE && now < topUpNoticeUntil) lcdTopUpNotice();
    else lcdRefresh();
  }

  // Cloud sync
  if (wifiUp && now - tPush >= FB_PUSH_MS) { tPush = now; pushState();  }
  if (wifiUp && now - tPull >= FB_PULL_MS) { tPull = now; pullConfig(); }

  // Connection state tracking
  bool linkNow = (WiFi.status() == WL_CONNECTED);
  if (!wifiUp && linkNow) { wifiUp = true;  initFirebase(); beginOverrideStream(); }
  if (wifiUp && !linkNow) { wifiUp = false; fbReady = false; }

  // One-time NTP kickoff, whenever WiFi first comes up -- whether that's
  // the normal case (already true the first time loop() runs, from
  // connectWiFi() in setup()) or a later reconnect after a drop. Only ever
  // fires once per boot; the SNTP client keeps itself resynced from there.
  if (wifiUp && !clockInitStarted) {
    clockInitStarted = true;
    initClock();
  }
}
