import { Platform } from "react-native";
import { TxRecord, TxDirection } from "./contractEvents";

const DIRECTION_LABEL: Record<TxDirection, string> = {
  mint: "Purchased",
  "transfer-in": "Received",
  "transfer-out": "Sent",
  burn: "Consumed",
};

function downloadBlob(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Web only -- triggers a browser file download, so there's nothing
 * meaningful to do on native. */
export function exportTransactionsCsv(transactions: TxRecord[], walletAddress: string) {
  if (Platform.OS !== "web") return;
  const header = ["Date", "Type", "Counterparty", "Amount (Wh)", "Tx Hash"];
  const rows = transactions.map((tx) => [
    new Date(tx.timestamp).toISOString(),
    DIRECTION_LABEL[tx.direction],
    tx.counterparty,
    String(tx.amountWh),
    tx.hash,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  const datePart = new Date().toISOString().slice(0, 10);
  downloadBlob(`energitoken-history-${walletAddress.slice(0, 8)}-${datePart}.csv`, csv, "text/csv;charset=utf-8;");
}

/** Opens a print-formatted report in a new tab and triggers the browser's
 * print dialog -- "Save as PDF" there produces the actual PDF. No PDF
 * library involved; this is the standard low-dependency way to get a real
 * PDF out of a web app. */
export function exportBillingReportPdf(transactions: TxRecord[], walletAddress: string) {
  if (Platform.OS !== "web") return;

  const totalPurchased = transactions.filter((t) => t.direction === "mint").reduce((s, t) => s + t.amountWh, 0);
  const totalReceived = transactions.filter((t) => t.direction === "transfer-in").reduce((s, t) => s + t.amountWh, 0);
  const totalSent = transactions.filter((t) => t.direction === "transfer-out").reduce((s, t) => s + t.amountWh, 0);
  const totalConsumed = transactions.filter((t) => t.direction === "burn").reduce((s, t) => s + t.amountWh, 0);

  const rowsHtml = transactions
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(
      (tx) => `
        <tr>
          <td>${new Date(tx.timestamp).toLocaleString()}</td>
          <td>${DIRECTION_LABEL[tx.direction]}</td>
          <td>${tx.counterparty}</td>
          <td style="text-align:right">${tx.amountWh.toLocaleString()} Wh</td>
        </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>EnergiToken billing report</title>
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #15141A; padding: 32px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 24px; }
  .summary { display: flex; gap: 24px; margin-bottom: 24px; }
  .summary div { border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px; }
  .summary strong { display: block; font-size: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
  th { color: #666; font-weight: 600; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>EnergiToken billing report</h1>
  <div class="meta">Wallet ${walletAddress} · generated ${new Date().toLocaleString()}</div>
  <div class="summary">
    <div><strong>${totalPurchased.toLocaleString()} Wh</strong>Purchased</div>
    <div><strong>${totalReceived.toLocaleString()} Wh</strong>Received</div>
    <div><strong>${totalSent.toLocaleString()} Wh</strong>Sent</div>
    <div><strong>${totalConsumed.toLocaleString()} Wh</strong>Consumed</div>
  </div>
  <table>
    <thead><tr><th>Date</th><th>Type</th><th>Counterparty</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;

  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
}
