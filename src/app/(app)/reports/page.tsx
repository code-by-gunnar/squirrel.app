import { PiggyBank, CalendarRange } from "lucide-react";
import { getBaseCurrency } from "@/lib/settings";
import { formatCurrency } from "@/lib/currency";
import { getMonthlySpend, getSpendTotals } from "@/lib/reports";
import { getActiveContextFilter } from "@/lib/contexts";
import { MonthlySpendChart } from "@/components/monthly-spend-chart";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="gap-0">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription>{label}</CardDescription>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

export default async function ReportsPage() {
  const filter = await getActiveContextFilter();
  const base = getBaseCurrency();
  const monthly = getMonthlySpend(filter);
  const totals = getSpendTotals(filter);
  const year = new Date().getFullYear();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          What you have actually spent over time, from recorded charges.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Total spent to date"
          value={formatCurrency(totals.allTime, base)}
          sub="all recorded charges"
          icon={PiggyBank}
        />
        <StatCard
          label="Spent this year"
          value={formatCurrency(totals.thisYear, base)}
          sub={`${year} so far`}
          icon={CalendarRange}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly spend</CardTitle>
          <CardDescription>
            Actual charges per month in {base}. The next 3 months (faded) are
            projected from your renewal schedule.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MonthlySpendChart data={monthly} baseCurrency={base} />
        </CardContent>
      </Card>
    </div>
  );
}
