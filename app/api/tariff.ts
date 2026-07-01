import type { IncomingMessage, ServerResponse } from "http";
import { TARIFF } from "./opay/create-payment";

type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

/** Returns current tariff so the app always renders server-authoritative rates. */
export default function handler(_req: IncomingMessage, res: Res) {
  res.status(200).json({
    version: TARIFF.version,
    whPerNgn: TARIFF.whPerNgn,
    minNgn: TARIFF.minNgn,
    maxNgn: TARIFF.maxNgn,
    label: `₦${TARIFF.minNgn.toLocaleString()} = ${TARIFF.whPerNgn / 1000} unit (1 kWh)`,
  });
}
