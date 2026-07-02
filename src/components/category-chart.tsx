"use client";

import { Cell, Pie, PieChart } from "recharts";
import type { CategorySpend } from "@/lib/stats";
import { formatCurrency } from "@/lib/currency";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

type Props = {
  data: CategorySpend[];
  baseCurrency: string;
};

export function CategoryChart({ data, baseCurrency }: Props) {
  const total = data.reduce((s, d) => s + d.monthly, 0);

  const chartConfig: ChartConfig = Object.fromEntries(
    data.map((d) => [d.name, { label: d.name, color: d.color }]),
  );

  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        No spending to show yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <ChartContainer
        config={chartConfig}
        className="relative aspect-square h-48 w-48 shrink-0"
      >
        <PieChart>
          <Pie
            data={data}
            dataKey="monthly"
            nameKey="name"
            innerRadius={58}
            outerRadius={80}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-muted-foreground">per month</span>
          <span className="text-xl font-semibold">
            {formatCurrency(total, baseCurrency)}
          </span>
        </div>
      </ChartContainer>

      <ul className="w-full space-y-2">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2 text-sm">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: d.color }}
            />
            <span className="flex-1 truncate">{d.name}</span>
            <span className="font-medium">
              {formatCurrency(d.monthly, baseCurrency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
