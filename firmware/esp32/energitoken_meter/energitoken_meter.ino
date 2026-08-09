// ============================================================================
// EnergiToken Smart Meter — ESP32 firmware
//
// Reads live electrical data from a PZEM-004T V4 sensor, shows it on a 20x4
// I2C LCD, sheds load on a 4-channel relay bank according to the household's
// budget (r1 = Critical..r4 = Luxury), and syncs everything to the same
// Firebase Realtime Database the EnergiToken app reads from
// (see firebase/schema.md and firebase/database.rules.json in this repo).
//
// Libraries (install via Arduino Library Manager):
//   - PZEM004Tv30      by Jakub Mandula
//   - LiquidCrystal_I2C by Frank de Brabander (or "LiquidCrystal I2C")
//   - ArduinoJson      by Benoit Blanchon (v6.x)
// Board package: esp32 by Espressif Systems.
// ============================================================================

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <PZEM004Tv30.h>

// ---------------------------------------------------------------------------
// 1. CONFIG — fill these in before flashing
// ---------------------------------------------------------------------------

const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Same project as app/src/config/firebase.ts.
const char* FIREBASE_HOST = "energitoken-b5ab3-default-rtdb.firebaseio.com";

// Firebase Console -> Project Settings -> Service accounts -> Database secrets
// (legacy). This key bypasses database.rules.json entirely, which is required
// here: every raw-reading field under /meters/{deviceId} has ".write": false
// for normal (even authenticated) clients — only the Admin SDK/secret can
// write them. Treat this like a password: don't commit it, don't share it.
const char* FIREBASE_SECRET = "YOUR_DATABASE_SECRET";

// PZEM-004T V4 on UART2 (avoids clashing with the USB/Serial monitor on UART0).
#define PZEM_RX_PIN 16   // ESP32 RX2 <- PZEM TX
#define PZEM_TX_PIN 17   // ESP32 TX2 -> PZEM RX

// 20x4 I2C LCD.
#define LCD_SDA_PIN 21
#define LCD_SCL_PIN 22
#define LCD_ADDR    0x27   // fall back to 0x3F if the screen stays blank

// 4-channel relay module. Wiring is ACTIVE LOW: driving the pin LOW energizes
// the relay coil (load ON); HIGH de-energizes it (load OFF).
#define RELAY_R1_PIN 32   // Critical  — never shed
#define RELAY_R2_PIN 33   // Essential — sheds at 95% of budget used
#define RELAY_R3_PIN 25   // Optional  — sheds at 85% of budget used
#define RELAY_R4_PIN 26   // Luxury    — sheds at 70% of budget used
const bool RELAY_ON  = LOW;
const bool RELAY_OFF = HIGH;

// Hold this pin LOW (button to GND) for 3s to enter pairing mode.
#define PAIR_BUTTON_PIN 27

// Budget-shedding thresholds, must match firebase/schema.md's tier contract.
const float THRESHOLD_R2 = 95.0;
const float THRESHOLD_R3 = 85.0;
const float THRESHOLD_R4 = 70.0;

// Timing.
const unsigned long SENSOR_READ_INTERVAL_MS  = 2000;    // poll PZEM
const unsigned long CLOUD_PUSH_INTERVAL_MS   = 8000;    // write /meters
const unsigned long BUDGET_PULL_INTERVAL_MS  = 20000;   // read budgetWh/overrides
const unsigned long PAIR_HOLD_MS             = 3000;    // long-press duration
const unsigned long PAIRING_WINDOW_MS        = 3600000; // 1h, mirrors api/devices/claim.ts

// ---------------------------------------------------------------------------
// 2. GLOBAL STATE
// ---------------------------------------------------------------------------

HardwareSerial pzemSerial(2);
PZEM004Tv30 pzem(pzemSerial, PZEM_RX_PIN, PZEM_TX_PIN);
LiquidCrystal_I2C lcd(LCD_ADDR, 20, 4);

String deviceId;           // last 6 hex chars of the MAC, e.g. "3B9D88"

float voltage = 0, current = 0, power = 0, frequency = 0, powerFactor = 0;
float accumulatedWh = 0;   // energy counted toward the *current* budget period

float budgetWh = 0;
bool haveBudget = false;
bool relayOverride[4]      = { false, false, false, false }; // value if present
bool relayOverrideSet[4]   = { false, false, false, false }; // is the override present?
bool relayState[4]         = { true, true, true, true };     // current ON/OFF, r1..r4

unsigned long lastSensorRead = 0;
unsigned long lastCloudPush  = 0;
unsigned long lastBudgetPull = 0;
unsigned long lastBudgetWhSeen = -1; // detects "new budget period started"

bool pairingMode = false;
unsigned long pairingStartedAt = 0;

// ---------------------------------------------------------------------------
// 3. SMALL HELPERS
// ---------------------------------------------------------------------------

void lcdRow(int row, const char* fmt, ...) {
  char buf[21];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  char padded[21];
  snprintf(padded, sizeof(padded), "%-20s", buf);
  lcd.setCursor(0, row);
  lcd.print(padded);
}

void setRelay(int tierIndex, bool on) {
  relayState[tierIndex] = on;
  int pin;
  switch (tierIndex) {
    case 0: pin = RELAY_R1_PIN; break;
    case 1: pin = RELAY_R2_PIN; break;
    case 2: pin = RELAY_R3_PIN; break;
    default: pin = RELAY_R4_PIN; break;
  }
  digitalWrite(pin, on ? RELAY_ON : RELAY_OFF);
}

String buildDeviceId() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char id[7];
  snprintf(id, sizeof(id), "%02X%02X%02X", mac[3], mac[4], mac[5]);
  return String(id);
}

// ---------------------------------------------------------------------------
// 4. WIFI
// ---------------------------------------------------------------------------

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  lcdRow(0, "EnergiToken Meter");
  lcdRow(1, "Connecting WiFi...");

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    delay(300);
  }

  if (WiFi.status() == WL_CONNECTED) {
    lcdRow(2, "WiFi OK");
    lcdRow(3, WiFi.localIP().toString().c_str());
  } else {
    lcdRow(2, "WiFi FAILED");
    lcdRow(3, "Will retry in loop");
  }
}

void ensureWiFi() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
  }
}

// ---------------------------------------------------------------------------
// 5. FIREBASE REST HELPERS
// (legacy Realtime Database REST API, auth=<database secret>, bypasses rules)
// ---------------------------------------------------------------------------

String firebaseUrl(const String& path) {
  return "https://" + String(FIREBASE_HOST) + path + ".json?auth=" + String(FIREBASE_SECRET);
}

bool firebasePatch(const String& path, const String& jsonBody) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(firebaseUrl(path));
  http.addHeader("Content-Type", "application/json");
  int code = http.PATCH(jsonBody);
  http.end();
  return code == 200;
}

// Returns "" on any failure so callers can fall back to last-known values.
String firebaseGet(const String& path) {
  if (WiFi.status() != WL_CONNECTED) return "";
  HTTPClient http;
  http.begin(firebaseUrl(path));
  int code = http.GET();
  String body = (code == 200) ? http.getString() : "";
  http.end();
  return body;
}

// ---------------------------------------------------------------------------
// 6. SENSOR READ
// ---------------------------------------------------------------------------

void readSensor() {
  float v = pzem.voltage();
  float i = pzem.current();
  float p = pzem.power();
  float f = pzem.frequency();
  float pf = pzem.pf();

  // PZEM returns NaN when it can't hear the sensor (bad wiring/no load).
  // Keep the last good reading rather than pushing garbage to Firebase.
  if (isnan(v)) return;

  voltage = v;
  current = isnan(i) ? 0 : i;
  power = isnan(p) ? 0 : p;
  frequency = isnan(f) ? 0 : f;
  powerFactor = isnan(pf) ? 0 : pf;

  // Integrate power draw since the last sample into a running Wh total for
  // the current budget period (Wh = W * hours elapsed).
  float hoursElapsed = SENSOR_READ_INTERVAL_MS / 3600000.0;
  accumulatedWh += power * hoursElapsed;
}

// ---------------------------------------------------------------------------
// 7. BUDGET PULL + RELAY LOGIC
// ---------------------------------------------------------------------------

void pullBudgetAndOverrides() {
  String body = firebaseGet("/meters/" + deviceId);
  if (body.length() == 0 || body == "null") return;

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) return;

  if (doc.containsKey("budgetWh")) {
    float newBudget = doc["budgetWh"].as<float>();

    // A different budgetWh than last time means the household just started a
    // new budget period (app writes a fresh value each time Budget is saved).
    // Reset this cycle's accumulator so percentUsed starts back at 0.
    if (haveBudget && newBudget != budgetWh) {
      accumulatedWh = 0;
    }
    budgetWh = newBudget;
    haveBudget = true;
  }

  const char* tierKeys[4] = { "r1", "r2", "r3", "r4" };
  if (doc.containsKey("relayOverrides")) {
    JsonObject overrides = doc["relayOverrides"];
    for (int t = 0; t < 4; t++) {
      if (overrides.containsKey(tierKeys[t])) {
        relayOverrideSet[t] = true;
        relayOverride[t] = overrides[tierKeys[t]].as<bool>();
      } else {
        relayOverrideSet[t] = false;
      }
    }
  }
}

void applyRelayLogic() {
  float percentUsed = haveBudget && budgetWh > 0 ? (accumulatedWh / budgetWh) * 100.0 : 0;
  if (percentUsed > 100) percentUsed = 100;

  // Automatic (budget-driven) decision per tier, before overrides.
  bool autoState[4];
  autoState[0] = true;                          // r1 Critical: never auto-shed
  autoState[1] = percentUsed < THRESHOLD_R2;     // r2 Essential
  autoState[2] = percentUsed < THRESHOLD_R3;     // r3 Optional
  autoState[3] = percentUsed < THRESHOLD_R4;     // r4 Luxury

  for (int t = 0; t < 4; t++) {
    bool desired = relayOverrideSet[t] ? relayOverride[t] : autoState[t];
    if (desired != relayState[t]) {
      setRelay(t, desired);
    }
  }
}

float currentPercentUsed() {
  if (!haveBudget || budgetWh <= 0) return 0;
  float p = (accumulatedWh / budgetWh) * 100.0;
  return p > 100 ? 100 : p;
}

// ---------------------------------------------------------------------------
// 8. CLOUD PUSH
// ---------------------------------------------------------------------------

void pushReading() {
  StaticJsonDocument<512> doc;
  doc["voltage"] = voltage;
  doc["current"] = current;
  doc["power"] = power;
  doc["frequency"] = frequency;
  doc["powerFactor"] = powerFactor;
  doc["energyWh"] = accumulatedWh;
  doc["percentUsed"] = currentPercentUsed();
  doc["updatedAt"] = (unsigned long long) millis(); // see note in explanation re: real time

  JsonObject relays = doc.createNestedObject("relays");
  relays["r1"] = relayState[0];
  relays["r2"] = relayState[1];
  relays["r3"] = relayState[2];
  relays["r4"] = relayState[3];

  String body;
  serializeJson(doc, body);
  firebasePatch("/meters/" + deviceId, body);
}

// ---------------------------------------------------------------------------
// 9. PAIRING MODE (long-press the setup button)
// ---------------------------------------------------------------------------

void checkPairButton() {
  static unsigned long pressStarted = 0;
  bool pressed = digitalRead(PAIR_BUTTON_PIN) == LOW;

  if (pressed && pressStarted == 0) {
    pressStarted = millis();
  } else if (!pressed) {
    pressStarted = 0;
  } else if (pressed && millis() - pressStarted >= PAIR_HOLD_MS && !pairingMode) {
    enterPairingMode();
  }
}

void enterPairingMode() {
  pairingMode = true;
  pairingStartedAt = millis();

  StaticJsonDocument<128> doc;
  doc["createdAt"] = (unsigned long long) time(nullptr) * 1000ULL;
  String body;
  serializeJson(doc, body);
  firebasePatch("/pendingDevices/" + deviceId, body);

  lcd.clear();
  lcdRow(0, "PAIRING MODE");
  lcdRow(1, "Enter this code");
  lcdRow(2, deviceId.c_str());
  lcdRow(3, "in the app now");
}

// api/devices/claim.ts sets pendingDevices/{id}/claimed = true once the app
// successfully links this device to a wallet.
void checkPairingClaimed() {
  if (!pairingMode) return;

  if (millis() - pairingStartedAt > PAIRING_WINDOW_MS) {
    pairingMode = false; // window api/devices/claim.ts enforces has expired
    return;
  }

  String body = firebaseGet("/pendingDevices/" + deviceId + "/claimed");
  if (body == "true") {
    pairingMode = false;
    lcd.clear();
    lcdRow(0, "Paired!");
  }
}

// ---------------------------------------------------------------------------
// 10. LCD DISPLAY (rotates through 2 screens every 3s while not pairing)
// ---------------------------------------------------------------------------

void updateDisplay() {
  if (pairingMode) return; // enterPairingMode() already owns the screen

  static unsigned long lastSwitch = 0;
  static int screen = 0;
  if (millis() - lastSwitch > 3000) {
    screen = (screen + 1) % 2;
    lastSwitch = millis();
  }

  if (screen == 0) {
    lcdRow(0, "V:%.1f  I:%.2fA", voltage, current);
    lcdRow(1, "P:%.0fW  F:%.1fHz", power, frequency);
    lcdRow(2, "PF:%.2f", powerFactor);
    lcdRow(3, "Budget: %.0f%% used", currentPercentUsed());
  } else {
    lcdRow(0, "Relay status:");
    lcdRow(1, "R1:%s  R2:%s", relayState[0] ? "ON " : "OFF", relayState[1] ? "ON " : "OFF");
    lcdRow(2, "R3:%s  R4:%s", relayState[2] ? "ON " : "OFF", relayState[3] ? "ON " : "OFF");
    lcdRow(3, "ID:%s", deviceId.c_str());
  }
}

// ---------------------------------------------------------------------------
// 11. SETUP / LOOP
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);

  pinMode(RELAY_R1_PIN, OUTPUT);
  pinMode(RELAY_R2_PIN, OUTPUT);
  pinMode(RELAY_R3_PIN, OUTPUT);
  pinMode(RELAY_R4_PIN, OUTPUT);
  setRelay(0, true);
  setRelay(1, true);
  setRelay(2, true);
  setRelay(3, true);

  pinMode(PAIR_BUTTON_PIN, INPUT_PULLUP);

  Wire.begin(LCD_SDA_PIN, LCD_SCL_PIN);
  lcd.init();
  lcd.backlight();

  connectWiFi();
  deviceId = buildDeviceId();

  configTime(0, 0, "pool.ntp.org"); // needed for real updatedAt/createdAt timestamps

  delay(1500);
  lcd.clear();
}

void loop() {
  ensureWiFi();
  checkPairButton();

  unsigned long now = millis();

  if (now - lastSensorRead >= SENSOR_READ_INTERVAL_MS) {
    lastSensorRead = now;
    readSensor();
    applyRelayLogic();
  }

  if (now - lastBudgetPull >= BUDGET_PULL_INTERVAL_MS) {
    lastBudgetPull = now;
    pullBudgetAndOverrides();
  }

  if (now - lastCloudPush >= CLOUD_PUSH_INTERVAL_MS) {
    lastCloudPush = now;
    pushReading();
  }

  if (pairingMode) {
    static unsigned long lastClaimCheck = 0;
    if (now - lastClaimCheck > 4000) {
      lastClaimCheck = now;
      checkPairingClaimed();
    }
  }

  updateDisplay();
}
