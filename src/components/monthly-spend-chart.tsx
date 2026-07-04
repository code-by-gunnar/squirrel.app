"use client";

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import type { MonthlySpend } from "@/lib/reports";
import { formatCurrency, currencySymbol } from "@/lib/currency";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

type Props = {
  data: MonthlySpend[];
  baseCurrency: string;
};

const config: ChartConfig = {
  total: { label: "Spend", color: "var(--primary)" },
};

export function MonthlySpendChart({ data, baseCurrency }: Props) {
  if (!data.some((d) => d.total > 0)) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No spending recorded yet. Charges appear here as your subscriptions renew.
      </div>
    );
  }

  const symbol = currencySymbol(baseCurrency).trim();

  return (
    <ChartContainer config={config} className="h-64 w-full">
      <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={12}
          interval="preserveStartEnd"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          fontSize={12}
          tickFormatter={(v) => `${symbol}${Math.round(Number(v))}`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => formatCurrency(Number(value), baseCurrency)}
            />
          }
        />
        <Bar dataKey="total" radius={[4, 4, 0, 0]}>
          {data.map((d) => (
            <Cell
              key={d.month}
              fill="var(--color-total)"
              fillOpacity={d.projected ? 0.35 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
