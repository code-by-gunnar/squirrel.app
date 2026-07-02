import Link from "next/link";
import { Wallet, CalendarClock, Layers, TrendingUp, ArrowRight } from "lucide-react";
import { listSubscriptions } from "@/lib/subscriptions";
import { computeDashboardStats } from "@/lib/stats";
import { getBaseCurrency } from "@/lib/settings";
import { formatCurrency } from "@/lib/currency";
import { CategoryChart } from "@/components/category-chart";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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

export default function DashboardPage() {
  const subs = listSubscriptions();
  const base = getBaseCurrency();
  const stats = computeDashboardStats(subs);
  const next = stats.upcoming[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Your subscription spending at a glance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Monthly spend"
          value={formatCurrency(stats.monthlyTotal, base)}
          sub="across all active subs"
          icon={Wallet}
        />
        <StatCard
          label="Yearly spend"
          value={formatCurrency(stats.yearlyTotal, base)}
          sub="projected over 12 months"
          icon={TrendingUp}
        />
        <StatCard
          label="Active subscriptions"
          value={String(stats.activeCount)}
          sub={`${subs.length} tracked in total`}
          icon={Layers}
        />
        <StatCard
          label="Next renewal"
          value={
            next
              ? next.daysUntil === 0
                ? "Today"
                : `${next.daysUntil}d`
              : "—"
          }
          sub={next ? `${next.name} · ${next.nextRenewal}` : "nothing upcoming"}
          icon={CalendarClock}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Spending by category</CardTitle>
            <CardDescription>Monthly equivalent in {base}</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryChart data={stats.byCategory} baseCurrency={base} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Upcoming renewals</CardTitle>
              <CardDescription>Next 5 payments</CardDescription>
            </div>
            <Button
              render={<Link href="/calendar" />}
              nativeButton={false}
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
            >
              Calendar
              <ArrowRight className="size-3.5" />
            </Button>
          </CardHeader>
          <CardContent>
            {stats.upcoming.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No upcoming renewals.
              </p>
            ) : (
              <ul className="divide-y">
                {stats.upcoming.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <span
                        className="flex size-8 items-center justify-center rounded-lg text-xs font-semibold text-white"
                        style={{ backgroundColor: s.categoryColor ?? "#64748b" }}
                      >
                        {s.name.charAt(0).toUpperCase()}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{s.name}</p>
                        <p className="text-xs text-muted-foreground">{s.nextRenewal}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {formatCurrency(s.price, s.currencyCode)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.daysUntil === 0 ? "Due today" : `in ${s.daysUntil}d`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
