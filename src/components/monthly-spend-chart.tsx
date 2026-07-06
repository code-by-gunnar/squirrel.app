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
  selectedMonth: string | null;
  onSelectMonth: (month: string) => void;
};

const config: ChartConfig = {
  recorded: { label: "Billed", color: "var(--primary)" },
  forecast: { label: "Forecast", color: "var(--primary)" },
};

export function MonthlySpendChart({ data, baseCurrency, selectedMonth, onSelectMonth }: Props) {
  if (!data.some((d) => d.total > 0)) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        No spending recorded yet. Charges appear here as your subscriptions renew.
      </div>
    );
  }

  const symbol = currencySymbol(baseCurrency).trim();
  const dim = (month: string) => (selectedMonth === null || selectedMonth === month ? 1 : 0.5);

  return (
    <ChartContainer config={config} className="h-64 w-full">
      <BarChart
        data={data}
        margin={{ top: 8, right: 4, left: 4, bottom: 0 }}
        onClick={(state) => {
          const key = data.find((d) => d.label === state?.activeLabel)?.month;
          if (key) onSelectMonth(key);
        }}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} width={52} fontSize={12} tickFormatter={(v) => `${symbol}${Math.round(Number(v))}`} />
        <ChartTooltip
          content={<ChartTooltipContent formatter={(value) => formatCurrency(Number(value), baseCurrency)} />}
        />
        <Bar dataKey="recorded" stackId="a" fill="var(--color-recorded)">
          {data.map((d) => (
            <Cell key={d.month} cursor="pointer" fillOpacity={dim(d.month)} />
          ))}
        </Bar>
        <Bar dataKey="forecast" stackId="a" fill="var(--color-forecast)" radius={[4, 4, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.month} cursor="pointer" fillOpacity={0.35 * dim(d.month)} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
