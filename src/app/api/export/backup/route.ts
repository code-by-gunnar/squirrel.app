import { buildBackup } from "@/lib/export";
import { toISODate } from "@/lib/billing";

export const dynamic = "force-dynamic";

export function GET() {
  const body = JSON.stringify(buildBackup(), null, 2);
  const filename = `squirrel-backup-${toISODate(new Date())}.json`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
