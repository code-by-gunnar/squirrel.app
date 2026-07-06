"use client";

import { useState } from "react";
import type { MonthlySpend } from "@/lib/reports";
import { formatCurrency } from "@/lib/currency";
import { MonthlySpendChart } from "@/components/monthly-spend-chart";
import { SubscriptionLogo } from "@/components/subscription-logo";
import { cn } from "@/lib/utils";

/** The client's current-month key (matches the server's within a day; guarded by a fallback). */
function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthlyReport({
  data,
  baseCurrency,
}: {
  data: MonthlySpend[];
  baseCurrency: string;
}) {
  const fallback = data[data.length - 1]?.month ?? null;
  const initial = data.some((m) => m.month === currentMonthKey())
    ? currentMonthKey()
    : fallback;
  const [selectedMonth, setSelectedMonth] = useState<string | null>(initial);

  const selected = data.find((m) => m.month === selectedMonth) ?? null;

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: "var(--primary)" }} />
          Billed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: "var(--primary)", opacity: 0.35 }} />
          Forecast
        </span>
      </div>

      <MonthlySpendChart
        data={data}
        baseCurrency={baseCurrency}
        selectedMonth={selectedMonth}
        onSelectMonth={setSelectedMonth}
      />

      {/* Drill-down panel */}
      {selected ? (
        <div className="border-t pt-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <p className="text-sm font-semibold">{monthTitle(selected.month)}</p>
              {selected.recorded > 0 && selected.forecast > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(selected.recorded, baseCurrency)} billed ·{" "}
                  {formatCurrency(selected.forecast, baseCurrency)} forecast
                </p>
              ) : null}
            </div>
            <p className="text-sm font-semibold">{formatCurrency(selected.total, baseCurrency)}</p>
          </div>

          {selected.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing that month.</p>
          ) : (
            <ul className="divide-y">
              {selected.items.map((it, i) => (
                <li
                  key={`${it.subId}-${it.date}-${i}`}
                  className={cn(
                    "flex items-center justify-between py-2.5",
                    it.kind === "forecast" && "text-muted-foreground",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <SubscriptionLogo name={it.name} logoUrl={it.logoUrl} color={it.categoryColor} />
                    <div>
                      <p className="text-sm font-medium text-foreground">{it.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {it.date}
                        {it.kind === "forecast" ? " · forecast" : ""}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm font-medium">{formatCurrency(it.amount, baseCurrency)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function monthTitle(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}
