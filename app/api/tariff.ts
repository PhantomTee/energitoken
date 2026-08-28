import type { IncomingMessage, ServerResponse } from "http";
import { TARIFF } from "./payments/create";

type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/** Returns current tariff so the app always renders server-authoritative rates. */
export default function handler(_req: IncomingMessage, res: Res) {
  // Bug fixed here: this used to compute whPerNgn / 1000, which is "how
  // many kWh does ONE NAIRA buy" (right number, wrong question) and then
  // labeled it as what minNgn buys -- at the default whPerNgn=1, that
  // produced "₦100 = 0.001 unit" when ₦100 actually buys 100 Wh = 0.1 unit,
  // a 100x error. The label now multiplies by minNgn, matching what it
  // actually claims to describe.
  const minUnits = (TARIFF.minNgn * TARIFF.whPerNgn) / 1000;
  res.status(200).json({
    version: TARIFF.version,
    whPerNgn: TARIFF.whPerNgn,
    minNgn: TARIFF.minNgn,
    maxNgn: TARIFF.maxNgn,
    label: `₦${TARIFF.minNgn.toLocaleString()} = ${minUnits} unit${minUnits === 1 ? "" : "s"} (1 kWh)`,
  });
}
