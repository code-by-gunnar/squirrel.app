import { buildPaymentsCsv } from "@/lib/export";
import { toISODate } from "@/lib/billing";

export const dynamic = "force-dynamic";

// UTF-8 BOM so Excel detects the encoding for currency symbols (GBP/EUR/JPY).
const BOM = String.fromCharCode(0xfeff);

export function GET() {
  const csv = buildPaymentsCsv();
  const filename = `squirrel-payments-${toISODate(new Date())}.csv`;
  return new Response(BOM + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
