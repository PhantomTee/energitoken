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

// Voltage trim, measured against a multimeter on the same line. Corrected
// in software rather than by touching the PZEM's own internal calibration,
// which carries real risk of permanently miscalibrating the unit for a fix
// this size. Only voltage is corrected -- current/power/energy were never
// independently verified against a reference, so applying the same offset
// to them would be an assumption rather than a measurement.
//
// No longer a compile-time constant, because it has already had to change
// twice. It was 1.026 (from 228-229V raw against a multimeter reading
// 234-235V). On 2026-08-31 the meter displayed 230-232V against the same
// multimeter reading 224V -- backing the 1.026 out gives a raw sensor value
// of 224-226V, i.e. the sensor was reading correctly and the old factor had
// become the source of the error rather than the correction for it. The
// resulting 0.995 is a trim of half a percent, inside the PZEM's own +/-0.5%
// rated accuracy class for voltage.
//
// Now persisted in NVS and overridable at runtime from
// /meters/{id}/voltageCal, so a re-trim never costs another reflash.
#define VOLTAGE_CAL_DEFAULT  0.995f   // 224.0 / 225.1, from the 2026-08-31 reference readings
#define VOLTAGE_CAL_MIN      0.90f    // clamped: a bad remote write must not silently skew billing
#define VOLTAGE_CAL_MAX      1.10f

#define POLL_MS             2000UL
#define LCD_MS              1000UL
// How long each face of the live screen's top row stays up before swapping
// (see lcdLive()). A multiple of LCD_MS so a face always gets whole refreshes;
// 4s is long enough to read a number without the row feeling like it flickers,
// short enough that you never wait long for the other face.
#define LCD_ALT_MS          4000UL
#define FB_PUSH_MS          5000UL
// How often a durable consumption sample is written to /meterHistory. The
// live node at /meters/{id} is overwritten on every push and keeps no
// series at all, so nothing in the system could plot consumption over time
// or show yesterday. One sample a minute is fine detail for a household
// load curve, caps a device at 1440 rows a day, and -- because the sample
// is keyed by its own local HHMM rather than pushed under a generated key
// -- a retry or a clock re-sync overwrites the same row instead of
// duplicating it.
#define HISTORY_PUSH_MS    60000UL
#define FB_PULL_MS          2000UL     // was 10s -- arbitrary choice, no real cost reason to keep a single device this slow
#define OVSTREAM_CHECK_MS     30UL     // how often loop() services the relayOverrides realtime stream
#define KEY_DEBOUNCE_MS      200UL
// Idle timeout for every non-live screen. Was 15s, which fired while the
// household was still plainly using the menu: the timer only ever restarted
// on a fresh PRESSED edge (see handleKeys()), so time spent reading a screen
// rather than pressing anything counted as idle. Fifteen seconds is not
// enough to read a six-character device ID off the LCD and type it into the
// app, nor to sit on the relay/balance screens and take in what they say --
// both are screens whose entire purpose is being read, not operated. The
// timeout exists so a menu left open on a wall-mounted meter eventually
// returns to the live reading, which one minute serves just as well.
#define MENU_TIMEOUT_MS    60000UL
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

// Consecutive failed reads before the meter stops trusting the relay
// positions a dead sensor left behind and moves to a defined safe state
// (see applySensorFailSafe()). At POLL_MS this is about two minutes, long
// enough that a brief bus glitch or a single dropped Modbus frame never
// trips it, short enough that a genuinely disconnected sensor doesn't leave
// unmetered load running all day. Deliberately far above PZEM_STALE_COUNT:
// marking the display stale is cosmetic and should happen quickly, moving
// the relays is not and should not.
#define PZEM_FAILSAFE_COUNT    60

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
  // Latched true by the first successful read of this boot and never
  // cleared. pushState() refuses to publish or sign an energy figure before
  // this is set: until the sensor has answered once, meas.energy is still
  // the struct's zero default, and publishing a signed zero would read to
  // the oracle as the meter's lifetime counter having reset. It would
  // rebaseline its checkpoint to zero, and the first genuine reading
  // afterwards would then look like the entire lifetime total had been
  // consumed since the last burn.
  bool  everValid = false;
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

// True once the sensor has been unresponsive long enough to stop trusting
// the relay positions it left behind -- see applySensorFailSafe(). Same
// authoritative-flag pattern as balanceGated/budgetGated below.
bool sensorFailSafe = false;

// Live voltage trim (see VOLTAGE_CAL_DEFAULT). Loaded from NVS at boot and
// overridable from /meters/{id}/voltageCal, so re-trimming this board never
// requires rebuilding and reflashing the firmware.
float voltageCal = VOLTAGE_CAL_DEFAULT;

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

uint32_t tPoll = 0, tLcd = 0, tPush = 0, tPull = 0, tPairCheck = 0, tPairBeep = 0, tCycle = 0, tOverride = 0, tOvStream = 0, tHistory = 0;

enum Ui { UI_LIVE, UI_MENU, UI_DAYS, UI_RELAYS, UI_BAL, UI_ID, UI_PAIR };
Ui       ui         = UI_LIVE;
// Where BACK should land from the read-only screens (relays, balance,
// device ID). They are reachable two ways -- through the menu, or by the
// '3'/'0' shortcuts straight from the live screen -- and used to exit
// unconditionally into the menu, so a shortcut pressed from the live screen
// dumped the household somewhere they had never been.
Ui       uiReturn   = UI_LIVE;
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

// Same transient-overlay mechanism as the top-up notice above, for the
// moment a budget arrives from the app or is cleared. Setting a budget used
// to change the live screen's third row and nothing else -- a household
// that pressed Set Budget on their phone and glanced at the meter had no
// confirmation the meter had actually received it, only a row that looked
// slightly different from the one before. Doesn't touch `ui`, so whatever
// screen was open resumes by itself once the deadline passes.
uint32_t budgetNoticeUntil   = 0;
float    noticeBudgetWh      = 0;
bool     noticeBudgetCleared = false;

// Last resetEnergyAt seen from the database, unix ms. Edge-triggered exactly
// like cycleStartedAt and budgetClearedAt: the meter acts when the value
// DIFFERS from the one it last saw, not on its presence, so the signal
// survives a reboot without re-firing. Persisted for that reason.
uint64_t lastEnergyResetAt   = 0;
uint32_t energyResetNoticeUntil = 0;

// True whenever applyBalanceGate() has the relays forced off for zero
// credit. Authoritative, not just informational: runAlgorithm() and
// applyOverrides() both check it and stand down while it's set, so the
// gate is the only writer touching the relays at zero balance instead of
// three independent writers on three different timers fighting each other
// every cycle. See the precedence table on applyBalanceGate() itself.
bool     balanceGated      = false;

// True whenever applyBudgetGate() has the relays forced off because the
// household's own daily allowance is fully used (budget.percent >= 100%).
// Same absolute-stop treatment as balanceGated, and for the same reason:
// without this, a "force on" override set before exhaustion (or tapped
// after, since evalChannel() alone can't refuse an override) would keep
// spending real balance past the household's own chosen daily cap with no
// way to plan around it -- the whole point of a budget is that hitting it
// means stop, not "unless you'd overridden something earlier." Recomputed
// fresh from budget.percent every check, not latched, so it self-clears
// the instant startNewCycle() resets percent back to 0 -- no separate
// release signal needed.
bool     budgetGated       = false;

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
// Three short chirps -- deliberately unlike the single long top-up tone and
// the two-tone pairing pattern, so "the meter took my budget" is audibly
// distinct from "money arrived" without having to look at the screen.
void beepBudgetSet() { beep(120, 80, 3); }
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
// eFuse and, per its own documentation, needs no WiFi/netif state --
// *except* that turned out not to hold on every arduino-esp32 core
// version. Confirmed on real hardware 2026-08-28: on the core version
// this project's pinned platformio.ini resolves to, calling it here (before
// connectWiFi() ever runs) returned all zeros, not a real MAC -- the same
// class of "looked stable, was actually wrong" failure the comment above
// already describes for WiFi.macAddress(), just via a different API this
// time. Community-confirmed root cause (espressif/arduino-esp32#11285):
// esp_base_mac_addr_get() used to fall back to esp_read_mac() internally
// when WiFi wasn't initialized yet; that fallback was removed in newer
// core versions. esp_read_mac(mac, ESP_MAC_WIFI_STA) is the documented,
// version-independent replacement -- works with no WiFi/netif state
// regardless of core version, so it's used here as an automatic fallback
// only when the primary read comes back zero, rather than replacing it
// outright: this preserves the exact value already established for both
// boards (4BF6F0, F94098) on whichever core version doesn't need the
// fallback at all, and self-heals on whichever does.
String makeDeviceID() {
  if (strlen(DEVICE_ID_OVERRIDE) > 0) return String(DEVICE_ID_OVERRIDE);
  uint8_t mac[6] = {0};
  esp_base_mac_addr_get(mac);
  bool allZero = true;
  for (uint8_t i = 0; i < 6; i++) {
    if (mac[i] != 0) { allZero = false; break; }
  }
  if (allZero) esp_read_mac(mac, ESP_MAC_WIFI_STA);
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

// Do two unix-ms timestamps fall on the same WAT calendar day? The process
// timezone is fixed to WAT-1 by initClock(), so localtime_r() already gives
// West Africa Time and this is the same "compare calendar dates, not elapsed
// time" test api/oracle/cycle-tick.ts applies server-side with its
// watDateString(). Used by pullConfig() to tell a genuine new-day roll from
// a cron tick that is merely restating a day this meter has already rolled
// itself. Returns false if either stamp is zero (nothing to compare).
bool sameLocalDay(uint64_t aMs, uint64_t bMs) {
  if (aMs == 0 || bMs == 0) return false;
  time_t a = (time_t)(aMs / 1000ULL);
  time_t b = (time_t)(bMs / 1000ULL);
  struct tm ta, tb;
  localtime_r(&a, &ta);
  localtime_r(&b, &tb);
  return ta.tm_yday == tb.tm_yday && ta.tm_year == tb.tm_year;
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
  voltageCal    = prefs.getFloat("vcal", VOLTAGE_CAL_DEFAULT);
  lastEnergyResetAt = prefs.getULong64("eRst", 0ULL);
  prefs.end();

  // A value persisted by an older build (or a corrupted read) must not be
  // able to put the trim somewhere billing-relevant and implausible.
  if (!(voltageCal >= VOLTAGE_CAL_MIN && voltageCal <= VOLTAGE_CAL_MAX))
    voltageCal = VOLTAGE_CAL_DEFAULT;
  Serial.printf("[NVS] voltageCal=%.4f\n", voltageCal);

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
  prefs.putFloat("vcal", voltageCal);
  prefs.putULong64("eRst", lastEnergyResetAt);
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
  meas.voltage = v * voltageCal;           // trimmed against a multimeter reference, see VOLTAGE_CAL_DEFAULT
  meas.current = i;
  meas.power   = p;
  meas.energy  = e * 1000.0f;                       // kWh -> Wh
  meas.freq    = isnan(f)  ? 0 : f;
  meas.pf      = isnan(pf) ? 0 : pf;
  meas.valid   = true;
  meas.everValid = true;
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
  // Both gates are authoritative, for the same reason: an override closing
  // a relay a gate just opened, then the gate reopening it again, is the
  // fighting-writers bug runAlgorithm() below was already protected from --
  // just with overrides as the second writer. Overriding while genuinely
  // at zero credit, or with the day's budget fully used, is deliberately
  // impossible; it works exactly as before at any positive balance under
  // the daily allowance.
  if (balanceGated) return;
  if (budgetGated) return;
  // Same reasoning for the sensor safe state: with no working sensor there
  // is no consumption accounting, so letting a stale "force on" override
  // re-close a tier this meter just shed would put unmetered load straight
  // back on and start the two writers fighting again.
  if (sensorFailSafe) return;
  for (uint8_t i = 0; i < 4; i++) {
    if (!overridePresent[i]) continue;          // no key means auto
    bool want = overrideValue[i];
    // Critical can still never be forced OFF by an override -- that's a
    // stray-tap safety net, not a statement that critical never sheds
    // (it does, via evalChannel(0, THRESH_R1) below, before 100% is even
    // reached against a positive balance, and applyBudgetGate() above
    // takes it the rest of the way once the daily allowance is fully
    // used). An override can still bring critical back on below 100%,
    // same as any other tier -- just not once the day's allowance itself
    // is exhausted.
    if (i == 0 && !want) want = true;
    if (relayState[i] != want) setRelay(i, want);
  }
}

/* ---------------------------------------------------------------------------
 *  Zero/unknown-balance gate: with no *confirmed* purchased credit, nothing
 *  runs, including critical, and nothing -- not even an override -- can
 *  bring anything back on until that changes.
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
 *  applyBudgetGate() right below is the same idea for the OTHER absolute
 *  stop -- the household's own daily allowance fully used -- which used to
 *  be a *self-chosen* limit an override could spend past (real balance,
 *  outside today's budgeted amount) until that was deliberately closed:
 *  hitting 100% is meant to be a hard stop the household can plan around,
 *  not one a stale override quietly punches a hole through.
 *
 *  Full precedence, called in this order from loop():
 *    1. Balance unknown or <= 0        -> balance gate:  everything off, absolute
 *    2. Balance positive, budget 100%  -> budget gate:   everything off, absolute
 *    3. Neither gate, override set     -> applyOverrides() wins
 *    4. Neither gate, no override      -> runAlgorithm() thresholds
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

/* ---------------------------------------------------------------------------
 *  Full budget exhaustion, same absolute treatment as applyBalanceGate()
 *  above: once budget.percent reaches 100%, nothing -- not even a manual
 *  "force on" override, on any tier -- keeps a relay powered. Hitting the
 *  daily allowance is meant to be a hard stop the household can plan
 *  around, not one an earlier override quietly punches a hole through.
 *  Only budgetSet households are gated by this; no budget set at all means
 *  unrestricted, same as everywhere else in this firmware.
 *
 *  Clears the same way balanceGated does on the newly-gated transition, and
 *  self-releases the same way too: nothing here sets it back to false
 *  directly, it's just recomputed from budget.percent every check, so the
 *  moment startNewCycle() resets percent to 0 (a new day, or an explicit
 *  Reset Budget/budgetClearedAt), this naturally reads false again on the
 *  very next pass with no separate release signal to keep in sync.
 * -------------------------------------------------------------------------*/
void applyBudgetGate() {
  bool wasGated = budgetGated;
  budgetGated = budget.budgetSet && budget.percent >= 100.0f;

  if (budgetGated && !wasGated) clearAllOverrides();

  if (!budgetGated) return;
  for (uint8_t i = 0; i < 4; i++) {
    if (relayState[i]) setRelay(i, false);
  }
}

/* ---------------------------------------------------------------------------
 *  Defined safe state for a sensor that has stopped answering.
 *
 *  Previously a dead PZEM simply froze the relays: readPZEM() returned
 *  false, meas.valid went false, runAlgorithm() returned at its first line,
 *  and whatever positions the relays happened to be in stayed that way
 *  indefinitely. The only sign was a "!!" marker on the live screen. A meter
 *  with a pulled sensor lead would therefore keep every tier energised for
 *  as long as it was left alone, with no consumption accounting behind it at
 *  all -- the budget silently stops being enforced while the household keeps
 *  drawing power.
 *
 *  The safe state is deliberately NOT "open everything". Cutting a
 *  household's fridge and lights because a Modbus lead worked loose is a
 *  worse outcome than the unmetered draw of the critical tier alone. So
 *  critical is held ON and every discretionary tier above it is opened:
 *  consumption drops to what the household genuinely cannot do without,
 *  and the condition is audible and visible rather than silent.
 *
 *  Sits below both absolute gates in the precedence order -- if the
 *  household has no credit, or has spent their whole allowance, those
 *  decisions still stand and this must not reopen critical against them.
 *  Self-releases the same way the budget gate does: pzemFailCount returns to
 *  zero on the first successful read, so this simply recomputes as false.
 * -------------------------------------------------------------------------*/
void applySensorFailSafe() {
  bool wasSafe   = sensorFailSafe;
  sensorFailSafe = (pzemFailCount >= PZEM_FAILSAFE_COUNT);

  if (sensorFailSafe && !wasSafe)
    Serial.printf("[SAFE] sensor unresponsive for %u reads -- shedding discretionary tiers, holding critical\n",
                  pzemFailCount);
  if (!sensorFailSafe && wasSafe)
    Serial.println("[SAFE] sensor recovered -- normal control resumed");

  // The absolute gates own the relays outright while they're set; standing
  // down here keeps this from becoming a third writer fighting them.
  if (balanceGated || budgetGated) return;
  if (!sensorFailSafe) return;

  if (!relayState[0]) setRelay(0, true);
  for (uint8_t i = 1; i < 4; i++) {
    if (relayState[i]) setRelay(i, false);
  }
}

void runAlgorithm() {
  if (!meas.valid) return;

  // MEASUREMENT first, CONTROL second, with the gate checks between them.
  //
  // The gate checks used to sit at the very top of this function, which
  // meant they skipped the accounting below as well as the switching. Once
  // budgetGated latched at 100%, cycleWh and percent both froze: the "E:"
  // figure on the live screen stopped climbing and stayed at whatever it
  // read the moment the cap was hit, so it was no longer the day's total.
  // percent freezing was worse than cosmetic -- applyBudgetGate() derives
  // budgetGated FROM percent, so a frozen percent could only ever be
  // cleared by a cycle roll, never by the household raising their budget.
  //
  // Measuring is not the same act as switching, and nothing about a gate
  // being set makes the meter's own arithmetic wrong. The gates exist to
  // decide who owns the relays, so they now guard only the evalChannel()
  // calls at the bottom.

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

  // ---- control below this line; measurement above it is unconditional ----
  // Whichever gate is set owns the relays outright, so the threshold
  // evaluation below must stand down -- but only the evaluation. Returning
  // any earlier than this would take the accounting above down with it,
  // which is exactly the bug described at the top of this function.
  if (balanceGated) return;   // no purchased credit: the gate owns the relays, not this
  if (budgetGated) return;    // daily allowance fully used: same treatment, see applyBudgetGate()

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
  } else {
    // No usable reading at the moment of the roll (sensor mid-failure, or a
    // midnight that landed before the first successful read of this boot).
    // Clearing baselineSet hands the capture to runAlgorithm(), which takes
    // a fresh baseline on the next valid read. Leaving the OLD baseline in
    // place instead silently undid the roll: cycleWh was zeroed here, then
    // immediately recomputed as meas.energy minus a baseline belonging to
    // the previous day, so the counter jumped straight back to yesterday's
    // total on the very next poll.
    budget.baselineSet = false;
  }
  budget.cycleWh  = 0;
  budget.percent  = 0;
  cycleLocalStart = millis();
  saveNVS();
  Serial.printf("[CYCLE] %s  stamp=%llu baseline=%.0f\n",
                reason, (unsigned long long)stamp, budget.baselineWh);
}

/* ---------------------------------------------------------------------------
 *  Zeroes the module's own lifetime energy register.
 *
 *  That register is non-volatile and lives inside the PZEM, not the ESP32,
 *  so it survives reboots, power cycles and reflashing -- there was no way
 *  to start a deployment from a genuine zero, and a meter fresh out of a
 *  drawer typically carries a couple of hundred watt-hours of bench testing.
 *
 *  The baseline MUST move with it. cycleWh is lifetime minus baseline, so
 *  zeroing the register while leaving a baseline of, say, 186 Wh makes that
 *  difference negative; it clamps to zero and then STAYS at zero until real
 *  consumption climbs back past 186 Wh, silently under-reporting a whole
 *  186 Wh of a household's usage. The two are only ever correct together.
 *
 *  Which is also why the baseline is only touched if the module actually
 *  acknowledged the reset. A failed reset with a zeroed baseline would do
 *  the opposite and jump the day's total straight to the full lifetime
 *  figure. On failure the stamp is still recorded, so a signal that cannot
 *  succeed is not retried against the module every two seconds forever.
 *
 *  The oracle needs no special handling: a lifetime counter going backwards
 *  is exactly the negative-delta case burn.ts already rebaselines on, so
 *  nothing is burned twice.
 * -------------------------------------------------------------------------*/
void performEnergyReset(uint64_t stamp) {
  bool ok = pzem.resetEnergy();
  lastEnergyResetAt = stamp;

  if (!ok) {
    Serial.println("[RESET] pzem.resetEnergy() failed -- baseline deliberately left alone");
    saveNVS();
    return;
  }

  meas.energy        = 0;
  budget.baselineWh  = 0;
  budget.baselineSet = true;
  budget.cycleWh     = 0;
  budget.percent     = 0;
  saveNVS();

  energyResetNoticeUntil = millis() + 4000UL;
  beepBudgetSet();
  Serial.println("[RESET] energy counter zeroed, baseline re-taken at 0 Wh");
}

/* ---------------------------------------------------------------------------
 *  Local fallback. If no cycle signal has arrived from the app/cron for
 *  longer than the grace period, roll the cycle on this device instead.
 *  budgetWh is a daily allowance, so rolling locally grants exactly one
 *  further day, which is the correct behaviour -- this keeps a late or
 *  failed cron from stranding the household at critical-only indefinitely.
 * -------------------------------------------------------------------------*/
bool cycleOverdue() {
  // No budgetSet check here either, for the same reason as
  // checkLocalMidnight(): this fallback is what rolls the day on a meter
  // that never gets NTP, and an unbudgeted meter needs its E figure reset
  // just as much as a budgeted one. A device that has not established a
  // cycle at all has nothing to measure elapsed time against yet.
  if (budget.cycleStartedAt == 0 && cycleLocalStart == 0) return false;

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
    // First sync of this boot. This used to record the day and return, full
    // stop -- which meant a meter that booted *after* local midnight (powered
    // off overnight, or simply reset, both routine) never rolled the midnight
    // it had already missed. It sat on a pre-midnight cycleStartedAt, kept
    // accumulating yesterday's consumption into today's percentUsed, and
    // didn't roll until either the NEXT midnight (up to ~24h late) or
    // checkCycleFallback()'s 25h grace, whichever came first. Observed live:
    // a cycle started 20:37 was still the active cycle at 01:20 the next day,
    // reading over 100% used.
    //
    // Fix is the same "compare calendar dates, not elapsed time" reasoning
    // api/oracle/cycle-tick.ts uses server-side: if the STORED cycle belongs
    // to an earlier calendar day than today, that midnight was missed while
    // this board was off, so roll it now. Same day -> genuinely mid-cycle,
    // leave it alone (the original no-spurious-mid-day-reset intent).
    lastSeenYday = tmNow.tm_yday;

    // A board with no cycle recorded yet establishes one now, so "this
    // cycle" is always a well-defined span. Without it, cycleStartedAt sat
    // at zero until the household first set a budget, and the E figure on
    // the live screen had no defined start.
    if (budget.cycleStartedAt == 0) {
      uint64_t startStamp = (uint64_t)now * 1000ULL;
      startNewCycle(startStamp, "first cycle established at clock sync");
      publishCycleStartedAt(startStamp);
      return;
    }

    time_t storedSec = (time_t)(budget.cycleStartedAt / 1000ULL);
    struct tm tmStored;
    localtime_r(&storedSec, &tmStored);
    if (tmStored.tm_yday == tmNow.tm_yday && tmStored.tm_year == tmNow.tm_year) return;

    uint64_t missedStamp = (uint64_t)now * 1000ULL;
    startNewCycle(missedStamp, "missed local midnight (caught up at boot)");
    publishCycleStartedAt(missedStamp);
    return;
  }
  if (tmNow.tm_yday == lastSeenYday) return;

  lastSeenYday = tmNow.tm_yday;

  // Rolls regardless of whether a budget is set. This used to return here
  // on !budgetSet, on the reasoning that there was no allowance to refill --
  // true, but the cycle is also what defines the "E:" figure the live screen
  // reports, and an unbudgeted meter therefore never reset it. Consumption
  // accumulated from whenever the baseline was first captured and grew
  // without bound, so a household running unrestricted saw a number that
  // looked like a daily total and was not one. Rolling with no budget set
  // costs nothing -- percent stays 0 while totalWh is 0, so no relay
  // decision changes -- and makes E mean the same thing in both cases.

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

// Prints s on `row` padded to the full width, so a shorter line never
// leaves the previous screen's trailing characters stranded on the right.
// Screens redrawn on a timer use this instead of lcd.clear(): clearing on
// every refresh makes the whole display visibly flicker once a second.
void lcdRow(uint8_t row, const char* s) {
  char pad[LCD_COLS + 1];
  snprintf(pad, sizeof(pad), "%-*s", LCD_COLS, s);
  lcd.setCursor(0, row);
  lcd.print(pad);
}

/* ---------------------------------------------------------------------------
 *  Budget bar.
 *
 *  The old version drew eight whole blocks, one per 12.5% of the budget, so
 *  the bar was blind to anything finer than an eighth: a household could
 *  spend a tenth of their day's allowance and watch a completely empty bar,
 *  then see it jump a whole cell at once. On the figure people actually
 *  watch to decide whether to switch something off, that is too coarse to
 *  act on.
 *
 *  An HD44780 character cell is five pixel columns wide, and the controller
 *  has eight CGRAM slots for user-defined glyphs. Defining five glyphs --
 *  one to five columns filled -- lets a cell be drawn partially full, so the
 *  same eight cells resolve 5x finer: 40 steps of 2.5% each instead of 8 of
 *  12.5%. Same width, same row layout, no extra hardware.
 * -------------------------------------------------------------------------*/
#define BAR_CELLS 8
#define BAR_SUB   5     // pixel columns per character cell

// Bits are the cell's five columns, bit 4 leftmost, so these fill from the
// left. Full height (all eight pixel rows) reads as a solid bar at a glance.
uint8_t BAR_GLYPH[BAR_SUB][8] = {
  { 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10 },   // 1 column
  { 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18 },   // 2
  { 0x1C, 0x1C, 0x1C, 0x1C, 0x1C, 0x1C, 0x1C, 0x1C },   // 3
  { 0x1E, 0x1E, 0x1E, 0x1E, 0x1E, 0x1E, 0x1E, 0x1E },   // 4
  { 0x1F, 0x1F, 0x1F, 0x1F, 0x1F, 0x1F, 0x1F, 0x1F },   // 5 = full cell
};

void lcdBar(float pct) {
  // 8 cells + 2 brackets = 10 chars; label is 10 chars; row totals 20.
  if (pct < 0)   pct = 0;
  if (pct > 100) pct = 100;

  uint16_t steps = (uint16_t)((pct / 100.0f) * (BAR_CELLS * BAR_SUB) + 0.5f);

  // A budget that has been touched at all shows at least one column, rather
  // than rounding down into an empty bar that looks like nothing was spent.
  if (steps == 0 && pct > 0) steps = 1;

  lcd.print('[');
  for (uint8_t c = 0; c < BAR_CELLS; c++) {
    uint16_t base   = (uint16_t)c * BAR_SUB;
    uint16_t filled = (steps > base) ? (steps - base) : 0;
    if (filled == 0)            lcd.print(' ');
    else if (filled >= BAR_SUB) lcd.write((uint8_t)(BAR_SUB - 1));   // full cell
    else                        lcd.write((uint8_t)(filled - 1));    // partial
  }
  lcd.print(']');
}

void lcdLive() {
  char l[21];

  // Top row alternates every LCD_ALT_MS between remaining credit and the
  // instantaneous V/I pair. Remaining credit is the number a prepaid
  // household actually cares about, and it used to be buried behind menu
  // item "3 Token balance" -- nobody navigates a menu to find out whether
  // their lights are about to go off. The other three rows are all full to
  // the last column (see below), so there was no free space to add it to;
  // sharing this row is what pays for it, and V/I are diagnostics that stay
  // readable four seconds out of every eight.
  //
  // Phase comes straight off millis() rather than a counter incremented per
  // refresh, so the cadence stays honest even if a refresh is skipped or the
  // live screen is left and re-entered.
  //
  // Both faces are padded to a full 20 columns before printing. Without that,
  // swapping from the longer V/I face to the shorter balance face would leave
  // that face's trailing characters stranded on the right-hand side -- the
  // old single-face code could print 18 chars and ignore the last 2 only
  // because the width never changed.
  char face[21];
  bool showBalance = ((millis() / LCD_ALT_MS) % 2) == 1;
  if (showBalance) {
    // Wh, matching the unit the meter itself measures and pushes (energyWh)
    // and the "E:" figure one row down, so the two are directly comparable.
    // 1 ENGY == 1 Wh, so this is also the raw token count.
    if (tokenBalKnown) snprintf(face, sizeof(face), "Bal:%.0f Wh", tokenBal);
    else               snprintf(face, sizeof(face), "Bal: --- Wh");
  } else {
    // Two spare columns on the right carry a stale marker once the sensor's
    // stopped answering -- without it the display just keeps showing the
    // last good reading forever, indistinguishable from a live one. It rides
    // on this face rather than the balance one because it annotates these
    // readings specifically, not the balance.
    bool stale = (pzemFailCount >= PZEM_STALE_COUNT);
    snprintf(face, sizeof(face), "V:%5.1f I:%5.2f %s",
             meas.voltage, meas.current, stale ? "!!" : "  ");
  }
  lcd.setCursor(0,0);
  snprintf(l, sizeof(l), "%-20s", face);
  lcd.print(l);

  lcd.setCursor(0,1);
  snprintf(l, sizeof(l), "P:%5.0fW E:%6.0fWh", meas.power, budget.cycleWh);
  lcd.print(l);

  // Row 2 now says WHETHER a budget is in force before it says how much of
  // one has been used. With no budget set, budget.percent sits at a hard 0
  // (runAlgorithm() leaves it there whenever totalWh is zero), so the old
  // unconditional "Bud:  0.0% [        ]" rendered identically to a freshly
  // rolled budget with nothing spent yet -- there was no way to tell "no
  // limit is being enforced" from "brand new day, nothing used". The two
  // gated states get their own text for the same reason: at zero credit or
  // a fully spent allowance every relay is open, and a bar pinned at either
  // end doesn't say which of the two put it there. Each string is padded to
  // exactly 20 columns so a longer previous state leaves nothing stranded.
  lcd.setCursor(0,2);
  if (balanceGated) {
    lcd.print("NO CREDIT: all off  ");
  } else if (sensorFailSafe) {
    lcd.print("SENSOR FAULT: safe  ");
  } else if (!budget.budgetSet) {
    // Nothing at all until a budget exists. A budget row is only meaningful
    // once there is a budget to report against: the bar was misleading
    // (an empty bar reads as "nothing spent yet", not "no limit is being
    // enforced"), and spelling that out in words was still a row spent
    // saying that the row has nothing to say. Blanked to the full width so
    // no characters survive from whichever state was drawn here before.
    lcd.print("                    ");
  } else if (budgetGated) {
    lcd.print("Budget SPENT: 100%  ");
  } else {
    snprintf(l, sizeof(l), "Bud:%5.1f%%", budget.percent);
    lcd.print(l);
    lcdBar(budget.percent);
  }

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
  // budgetWh arriving from the app is ALREADY a daily allowance -- the
  // Budget screen divides the household's available credit by their chosen
  // duration before writing it (see setBudgetWh in app/src/services). The
  // old line divided that daily figure by the day count a second time and
  // printed the result as "Daily:", which was a number with no meaning:
  // a 5,000 Wh/day allowance over 30 days displayed as 166.7 Wh. Show the
  // allowance as it actually stands instead.
  if (budget.budgetSet && budget.totalWh > 0) {
    lcd.print("Daily: ");
    lcd.print(budget.totalWh, 0);
    lcd.print("Wh");
  } else {
    lcd.print("No budget set yet");
  }
  lcd.setCursor(0,3); lcd.print("UP/DN   ENT=save");
}

// All four tiers, one per row. The old version spent row 0 on a "Relay
// states" title and then had room for only three tiers, silently omitting
// Luxury -- the tier most likely to actually be shed, and so the one a
// household checking this screen most wants to see. The screen is reached
// from a menu entry already labelled "Relay states", so the title was
// paying a whole row for a word the user had just read.
void lcdRelays() {
  char l[32];
  for (uint8_t i = 0; i < 4; i++) {
    snprintf(l, sizeof(l), "%c %-12s %-3s %c",
             (char)('1' + i), TIER_NAME[i],
             relayState[i] ? "ON" : "OFF",
             overridePresent[i] ? '*' : ' ');
    lcdRow(i, l);
  }
}

void lcdBalance() {
  char l[32];
  lcdRow(0, "Token balance");
  if (tokenBalKnown) {
    snprintf(l, sizeof(l), "%.0f ENGY", tokenBal);
    lcdRow(1, l);
    snprintf(l, sizeof(l), "= %.0f Wh", tokenBal);
    lcdRow(2, l);
  } else {
    // Distinguishes "this board has never been told a balance" from a
    // genuine zero -- the two drive completely different relay behaviour
    // (see applyBalanceGate) but both used to print "0 ENGY".
    lcdRow(1, "--- ENGY");
    lcdRow(2, "not synced yet");
  }
  lcdRow(3, wifiUp ? "Synced" : "Offline - cached");
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

// Shown over the live screen for a few seconds when a budget is set,
// changed, or cleared. States the figure the meter actually received, in
// both the unit it measures (Wh) and the unit the app talks in (units), so
// a household can confirm at a glance that the two agree.
void lcdBudgetNotice() {
  char l[32];
  if (noticeBudgetCleared) {
    lcdRow(0, "  BUDGET CLEARED");
    lcdRow(1, "");
    lcdRow(2, "  No limit enforced");
    lcdRow(3, "  All loads restored");
    return;
  }
  lcdRow(0, "    BUDGET SET");
  snprintf(l, sizeof(l), "  %.0f Wh/day", noticeBudgetWh);
  lcdRow(1, l);
  snprintf(l, sizeof(l), "  = %.1f units/day", noticeBudgetWh / 1000.0f);
  lcdRow(2, l);
  lcdRow(3, "  resets at 00:00");
}

// Shown over the live screen for a few seconds after the energy counter is
// zeroed, so the reset is visibly acknowledged on the meter itself rather
// than only inferable from E dropping to 0.
void lcdEnergyResetNotice() {
  lcdRow(0, "   ENERGY RESET");
  lcdRow(1, "");
  lcdRow(2, "  Counter zeroed");
  lcdRow(3, "  Now measuring from 0");
}

void lcdDeviceId() {
  lcd.clear();
  lcd.setCursor(0,0); lcd.print("Device ID:");
  lcd.setCursor(0,1); lcd.print(deviceID);
  lcd.setCursor(0,2); lcd.print("Enter in the app");
  lcd.setCursor(0,3); lcd.print("BACK = exit");
}

void lcdPairing() {
  // Redrawn every LCD_MS while pairing is active, so it pads rather than
  // clears for the same anti-flicker reason as the screens above.
  char l[32];
  lcdRow(0, "PAIRING MODE");
  snprintf(l, sizeof(l), "ID: %s", deviceID.c_str());
  lcdRow(1, l);
  uint32_t leftMin = (PAIR_WINDOW_MS - (millis() - pairingStart)) / 60000UL;
  snprintf(l, sizeof(l), "Open in %lu min", (unsigned long)leftMin);
  lcdRow(2, l);
  lcdRow(3, "BACK = cancel");
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

  // Any key activity at all -- PRESSED, HOLD or RELEASED -- counts as the
  // household still interacting, so loop()'s idle timeout measures genuine
  // inactivity. This used to sit further down, below the "act only on a
  // fresh PRESSED" filter, which meant holding a key to scroll (state goes
  // PRESSED once, then HOLD for as long as it's down) stopped refreshing
  // the timer, and a long hold could return to the live screen with the key
  // still physically pressed.
  menuTouch = millis();

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

  beepKey();

  bool up  = (key == '1');
  bool dn  = (key == '2');
  bool ent = (key == '#');
  bool bk  = (key == '*');

  switch (ui) {
    case UI_LIVE:
      if (ent) { ui = UI_MENU; menuIdx = 0; }
      // Shortcuts remember they came from the live screen, so BACK returns
      // there rather than into a menu the household never opened.
      if (key == '3') { uiReturn = UI_LIVE; ui = UI_ID; }    // shortcut: straight to Device ID
      if (key == '0') { uiReturn = UI_LIVE; ui = UI_BAL; }   // shortcut: straight to balance
      break;

    case UI_MENU:
      if (up) menuIdx = (menuIdx + MENU_N - 1) % MENU_N;
      if (dn) menuIdx = (menuIdx + 1) % MENU_N;
      if (bk) ui = UI_LIVE;
      if (ent) {
        switch (menuIdx) {
          case 0: inputDays = budget.days; ui = UI_DAYS; break;
          case 1: uiReturn = UI_MENU; ui = UI_RELAYS; break;
          case 2: uiReturn = UI_MENU; ui = UI_BAL;    break;
          case 3: uiReturn = UI_MENU; ui = UI_ID;     break;
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
      if (bk || ent) ui = uiReturn;
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
  //
  // energyWhInt is the module's LIFETIME cumulative total, not this cycle's
  // consumption. api/oracle/burn.ts burns
  //   energyWhInt - burnCheckpoints/{id}/lastBurnedWh
  // which only settles correctly against a MONOTONIC counter. This used to
  // push budget.cycleWh, which resets to zero at every midnight roll: the
  // oracle then saw a negative delta, logged "meter counter reset --
  // rebaselining checkpoint" and burned NOTHING, so everything consumed
  // between the last successful burn and midnight went permanently
  // unsettled. With the burn cron firing irregularly (burn-oracle.yml's own
  // comment documents 3-7h gaps) that was hours of unbilled consumption
  // every single day. meas.energy is the PZEM's own lifetime register,
  // which only goes backwards if the module is reset or replaced -- exactly
  // the case burn.ts's rebaseline path was actually written for.
  //
  // energyWh stays cycle-scoped: the app's budget maths (usedUnits,
  // percentUsed, getUnbudgetedWh) is all built on "this cycle", so moving
  // that field would break the Budget and Transfer screens. The lifetime
  // figure gets its own field for the Dashboard's pending/settled badge,
  // which has to compare like with like against lastBurnedWh.
  uint32_t energyWhInt = (uint32_t)(meas.energy > 0 ? meas.energy : 0);

  FirebaseJson j;
  j.set("voltage",     meas.voltage);      // V
  j.set("current",     meas.current);      // A
  j.set("power",       meas.power);        // W
  j.set("frequency",   meas.freq);         // Hz
  j.set("powerFactor", meas.pf);           // 0..1
  j.set("energyWh",    budget.cycleWh);    // Wh, current budget cycle only (app budget maths)
  // Held back until the sensor has answered at least once this boot -- see
  // Meas::everValid. updateNode() merges, so omitting these three simply
  // leaves the last published values in place rather than zeroing them.
  if (meas.everValid) {
    j.set("energyTotalWh", meas.energy);   // Wh lifetime, float -- pairs with lastBurnedWh
    j.set("energyWhInt",   energyWhInt);   // Wh lifetime, floored -- what's actually signed
    j.set("sig",           signEnergyReading(energyWhInt));
    // Tells the oracle what energyWhInt counts. burn.ts refuses to settle
    // across a change in this marker and rebaselines instead, which is what
    // makes the cycle-scale -> lifetime-scale switch above safe to deploy:
    // without it the first run after flashing would read the jump from a
    // cycle-scale checkpoint to a lifetime reading as one enormous burn.
    j.set("energyScale",   "lifetime");
  } else {
    // Explicitly NULL these rather than simply omitting them. updateNode
    // merges, so omitting a field leaves whatever was written last time --
    // and after a reflash that is a value from the previous firmware, which
    // the oracle then reads as a current reading. That is not theoretical:
    // a board flashed before its sensor was connected kept publishing a
    // stale energyWhInt of 0, the oracle read 0 against a checkpoint of 125,
    // took it for a counter reset and rebaselined to zero. The moment the
    // sensor came up reporting its true 208 Wh lifetime, the whole 208
    // looked unsettled. Nulling deletes the keys, so a meter that has
    // measured nothing reads as ABSENT -- which burn.ts already refuses to
    // act on -- rather than as having measured zero.
    j.set("energyTotalWh");
    j.set("energyWhInt");
    j.set("sig");
    j.set("energyScale");
  }
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

/* ---------------------------------------------------------------------------
 *  Durable consumption log.
 *
 *  /meters/{id} is a single live snapshot, overwritten on every push, so
 *  nothing in the system could plot consumption over time or answer "what
 *  did yesterday look like". The app's own live chart was a ten-minute
 *  in-memory buffer that emptied whenever the screen was left, and it only
 *  ever filled while somebody had the app open. This writes the series the
 *  meter is uniquely placed to record: it is the thing that is always on.
 *
 *  Keyed by the sample's own local date and HH:MM rather than pushed under a
 *  generated key. That makes a write idempotent -- a retry, or two samples
 *  landing in the same minute after an NTP correction, overwrite one row
 *  instead of appending a duplicate -- caps a device at 1440 rows per day,
 *  and lets the server read or delete a whole day as one node.
 *
 *  `e` is the LIFETIME register, not cycleWh: consumption between two
 *  samples is their difference, and cycleWh resets at midnight, which would
 *  make that difference negative across the roll. Lifetime energy is
 *  monotonic, so a delta is always real consumption. `w` is the
 *  instantaneous reading, kept for a live feel; the honest consumption
 *  curve is derived from the energy deltas server-side.
 * -------------------------------------------------------------------------*/
void pushHistory() {
  if (!(wifiUp && fbReady && Firebase.ready())) return;
  if (!meas.everValid) return;     // nothing measured yet this boot

  time_t now = time(nullptr);
  if (now < 1700000000UL) return;  // a sample that cannot be placed in time is worthless

  struct tm tmNow;
  localtime_r(&now, &tmNow);
  char day[9], hhmm[5];
  strftime(day,  sizeof(day),  "%Y%m%d", &tmNow);
  strftime(hhmm, sizeof(hhmm), "%H%M",   &tmNow);

  String path = "/meterHistory/" + deviceID + "/" + String(day) + "/" + String(hhmm);
  FirebaseJson j;
  j.set("w", meas.power);     // W, instantaneous
  j.set("e", meas.energy);    // Wh, lifetime cumulative -- deltas give real consumption
  if (!Firebase.RTDB.setJSON(&fbdo, path.c_str(), &j))
    Serial.println("History push failed: " + fbdo.errorReason());
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
        // Recompute beta against the new allowance immediately. Without
        // this, a household already at 100% stayed gated: applyBudgetGate()
        // derives budgetGated from budget.percent, but percent is only ever
        // recalculated inside runAlgorithm(), which returns early while
        // budgetGated is set. Raising the budget therefore could not release
        // the gate on its own -- the household sat in the dark until the
        // next cycle roll, despite now being under their new cap. Normally
        // masked because the app writes cycleStartedAt alongside budgetWh
        // and the roll resets percent anyway, but a bare budgetWh write
        // (Firebase console, a future partial update) deadlocked.
        if (budget.totalWh > 0) {
          budget.percent = (budget.cycleWh / budget.totalWh) * 100.0f;
          if (budget.percent < 0) budget.percent = 0;
        }
        saveNVS();
        // Confirm receipt on the meter itself, audibly and on screen. Fires
        // for any real change including the first budget ever set, not just
        // an increase -- `topUp` alone left a household lowering their
        // budget with no feedback at all.
        noticeBudgetWh      = v;
        noticeBudgetCleared = false;
        budgetNoticeUntil   = millis() + 4000UL;
        if (topUp) beepTopUp();
        else       beepBudgetSet();
      }
    }
  }

  // resetEnergyAt -- READ ONLY, unix ms, edge-triggered like cycleStartedAt
  // and budgetClearedAt above. Zeroes the module's own lifetime register so
  // a deployment can start from a true zero rather than from whatever the
  // sensor accumulated on the bench. See performEnergyReset().
  if (json.get(result, "resetEnergyAt") && result.success) {
    uint64_t v = (uint64_t)result.doubleValue;
    if (v > 0 && v != lastEnergyResetAt) performEnergyReset(v);
  }

  // voltageCal -- READ ONLY, optional. Lets this board's voltage trim be
  // re-measured and corrected without a rebuild and reflash (see
  // VOLTAGE_CAL_DEFAULT for why that stopped being acceptable). Clamped and
  // only persisted on a real change, so a poll reading the same value back
  // every 2s doesn't write flash every 2s.
  if (json.get(result, "voltageCal") && result.success) {
    float v = result.floatValue;
    if (v >= VOLTAGE_CAL_MIN && v <= VOLTAGE_CAL_MAX && fabs(v - voltageCal) > 0.0005f) {
      Serial.printf("[CAL] voltage trim %.4f -> %.4f (from database)\n", voltageCal, v);
      voltageCal = v;
      saveNVS();
    }
  }

  // cycleStartedAt — READ ONLY, unix ms. Written by the app on a plan
  // change and by the daily cron. This is the sole trigger for starting a
  // new budget cycle (see startNewCycle). Read as a double, not a float --
  // a unix-ms timestamp exceeds a 32-bit float's exact-integer range, and
  // FirebaseJsonData.doubleValue holds it exactly.
  //
  // Guarded so this meter's own local-midnight roll stays authoritative for
  // the day it covers. checkLocalMidnight() rolls within a second or two of
  // 00:00 WAT and mirrors the stamp back via publishCycleStartedAt(); if
  // that mirror write fails (offline at midnight, which is exactly when a
  // meter is most likely to be), the server still holds yesterday's stamp,
  // so the next cycle-tick sees a stale WAT date and rolls again -- hours
  // late, at whatever irregular time GitHub Actions happens to fire. The
  // firmware would then take that as a fresh signal and re-roll a day it
  // had already rolled, handing the household a second full allowance and
  // clearing their overrides mid-afternoon. Comparing WAT calendar days
  // (the same test cycle-tick.ts makes server-side) accepts a genuine new
  // day and ignores a restatement of the current one.
  //
  // A budget the household sets or changes mid-day is deliberately NOT an
  // exception. setBudgetWh() writes a fresh cycleStartedAt alongside
  // budgetWh, and honouring that as a roll re-baselined the meter mid-
  // afternoon, so the day's consumption figure restarted from zero and the
  // allowance covered only the hours that happened to remain. Adopting the
  // stamp without re-baselining keeps the daily total meaning one calendar
  // day, and makes the allowance apply to that whole day -- including the
  // part already spent before the budget existed.
  //
  // Escape hatches remain for the cases with no better information: no
  // local stamp yet, or no synced clock to compare dates with.
  if (json.get(result, "cycleStartedAt") && result.success) {
    uint64_t v = (uint64_t)result.doubleValue;
    if (v > 0 && v != budget.cycleStartedAt) {
      if (budget.cycleStartedAt == 0 || unixMillis() == 0
          || !sameLocalDay(v, budget.cycleStartedAt)) {
        startNewCycle(v, "signal from database");
      } else {
        // Same WAT day as the cycle already running: adopt the server's
        // stamp so the two agree and this comparison stays stable, but do
        // not restart the cycle or touch the baseline.
        budget.cycleStartedAt = v;
        saveNVS();
        Serial.println("[CYCLE] same-day server stamp adopted, not re-rolled");
      }
    }
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
      noticeBudgetCleared = true;
      budgetNoticeUntil   = millis() + 4000UL;
      beepBudgetSet();
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

  // Load the partial-fill glyphs the budget bar draws with. Must happen
  // after lcd.init(), which clears CGRAM, and before anything calls
  // lcdBar() -- an uninitialised CGRAM slot renders as garbage, not blank.
  for (uint8_t i = 0; i < BAR_SUB; i++) lcd.createChar(i, BAR_GLYPH[i]);

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

  tPoll = tLcd = tPush = tPull = tCycle = tOverride = tOvStream = tHistory = millis();
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

  // Manual overrides and both absolute gates, independent of PZEM
  // validity -- a loose sensor lead must not freeze any of them.
  if (now - tOverride >= OVERRIDE_APPLY_MS) {
    tOverride = now;
    applyBalanceGate();     // must run first -- sets balanceGated, which everything below checks
    applyBudgetGate();      // same reasoning -- sets budgetGated
    applySensorFailSafe();  // third in precedence: yields to both gates, overrides yield to it
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

  // Display. The relay and balance screens are refreshed on this timer too:
  // both show live state (relay positions, synced token balance) but used to
  // be drawn once on entry and then left frozen, so a relay shedding while
  // the household watched that very screen changed nothing on it. Both now
  // redraw in place via lcdRow() rather than clearing, so adding them here
  // costs no flicker. The screens left out are the ones showing static text
  // or text being edited (menu, day entry, device ID), where a periodic
  // redraw would buy nothing.
  bool liveScreen = (ui == UI_LIVE || ui == UI_PAIR || ui == UI_RELAYS || ui == UI_BAL);
  if (liveScreen && now - tLcd >= LCD_MS) {
    tLcd = now;
    // Top-up wins a tie: money arriving is the more consequential of the
    // two, and both overlays clear within seconds anyway.
    if      (ui == UI_LIVE && now < topUpNoticeUntil)       lcdTopUpNotice();
    else if (ui == UI_LIVE && now < budgetNoticeUntil)      lcdBudgetNotice();
    else if (ui == UI_LIVE && now < energyResetNoticeUntil) lcdEnergyResetNotice();
    else lcdRefresh();
  }

  // Cloud sync
  if (wifiUp && now - tPush >= FB_PUSH_MS) { tPush = now; pushState();  }
  if (wifiUp && now - tPull >= FB_PULL_MS) { tPull = now; pullConfig(); }
  if (wifiUp && now - tHistory >= HISTORY_PUSH_MS) { tHistory = now; pushHistory(); }

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
