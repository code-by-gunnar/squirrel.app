import { buildImportTemplate } from "@/lib/import-csv";

export const dynamic = "force-dynamic";

// UTF-8 BOM so Excel opens it cleanly (matches the export routes).
const BOM = String.fromCharCode(0xfeff);

export function GET() {
  return new Response(BOM + buildImportTemplate(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="squirrel-import-template.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
