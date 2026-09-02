/* ===========================================================================
 *  EnergiToken smart energy meter -- ESP-B  (device F94098)
 *
 *  Flash this sketch to board B. Everything the meter does lives in
 *  ../common/energitoken_meter_common.h, which both boards share; the only
 *  thing this file decides is the relay drive polarity, and it decides it by
 *  existing rather than by anyone remembering to edit a constant.
 *
 *  B's relay module energises its coils on a logic HIGH -- the opposite of A.
 *  Flashing A's build onto this board inverts every relay decision it makes.
 *
 *  Do not put board-specific logic here beyond the define below. If the two
 *  boards ever need to differ in some other way, add a second macro and
 *  branch on it inside the shared header, so there is still one copy of the
 *  firmware rather than two that drift apart.
 * ===========================================================================*/
#define BOARD_ESP_B
#include "../common/energitoken_meter_common.h"
