"use client";

import { useMemo, useState } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  format,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { EnrichedSubscription } from "@/lib/subscriptions";
import { renewalsInRange, toISODate, type BillingCycle } from "@/lib/billing";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type DayEntry = { sub: EnrichedSubscription };

export function CalendarView({
  subscriptions,
  baseCurrency,
}: {
  subscriptions: EnrichedSubscription[];
  baseCurrency: string;
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<string | null>(toISODate(new Date()));

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStart, gridEnd],
  );

  // Map ISO date -> subscriptions renewing that day, across the visible grid.
  const byDay = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    const active = subscriptions.filter((s) => s.active);
    for (const sub of active) {
      const dates = renewalsInRange(
        sub.startDate,
        sub.billingCycle as BillingCycle,
        sub.billingInterval,
        gridStart,
        gridEnd,
      );
      for (const d of dates) {
        const key = toISODate(d);
        const list = map.get(key) ?? [];
        list.push({ sub });
        map.set(key, list);
      }
    }
    return map;
  }, [subscriptions, gridStart, gridEnd]);

  const selectedEntries = selected ? (byDay.get(selected) ?? []) : [];
  const selectedTotal = selectedEntries.reduce((s, e) => s + e.sub.priceBase, 0);
  const today = toISODate(new Date());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">When your subscriptions renew.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setCursor(subMonths(cursor, 1))} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-36 text-center text-sm font-medium">
            {format(cursor, "MMMM yyyy")}
          </span>
          <Button variant="outline" size="icon" onClick={() => setCursor(addMonths(cursor, 1))} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(startOfMonth(new Date()))}>
            Today
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Month grid */}
        <Card className="lg:col-span-2">
          <CardContent className="p-3 sm:p-4">
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d) => (
                <div key={d} className="pb-2 text-center text-xs font-medium text-muted-foreground">
                  {d}
                </div>
              ))}
              {days.map((day) => {
                const key = toISODate(day);
                const entries = byDay.get(key) ?? [];
                const inMonth = isSameMonth(day, cursor);
                const isToday = key === today;
                const isSelected = key === selected;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelected(key)}
                    className={cn(
                      "flex aspect-square flex-col items-center justify-start gap-1 rounded-lg border border-transparent p-1.5 text-sm transition-colors",
                      inMonth ? "text-foreground" : "text-muted-foreground/40",
                      isSelected ? "border-primary bg-primary/5" : "hover:bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-xs",
                        isToday && "bg-primary font-semibold text-primary-foreground",
                      )}
                    >
                      {format(day, "d")}
                    </span>
                    {entries.length > 0 ? (
                      <div className="flex flex-wrap items-center justify-center gap-0.5">
                        {entries.slice(0, 3).map((e, i) => (
                          <span
                            key={i}
                            className="size-1.5 rounded-full"
                            style={{ backgroundColor: e.sub.categoryColor ?? "#64748b" }}
                          />
                        ))}
                        {entries.length > 3 ? (
                          <span className="text-[9px] leading-none text-muted-foreground">
                            +{entries.length - 3}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Selected day detail */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {selected ? format(new Date(selected), "EEEE, d MMM") : "Select a day"}
            </CardTitle>
            <CardDescription>
              {selectedEntries.length === 0
                ? "Nothing renews on this day."
                : `${selectedEntries.length} renewal${selectedEntries.length > 1 ? "s" : ""}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {selectedEntries.map(({ sub }, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-8 items-center justify-center rounded-lg text-xs font-semibold text-white"
                    style={{ backgroundColor: sub.categoryColor ?? "#64748b" }}
                  >
                    {sub.name.charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{sub.name}</p>
                    {sub.categoryName ? (
                      <p className="text-xs text-muted-foreground">{sub.categoryName}</p>
                    ) : null}
                  </div>
                </div>
                <p className="text-sm font-medium">
                  {formatCurrency(sub.price, sub.currencyCode)}
                </p>
              </div>
            ))}
            {selectedEntries.length > 1 ? (
              <div className="flex items-center justify-between px-1 pt-2 text-sm">
                <span className="text-muted-foreground">Total that day</span>
                <span className="font-semibold">
                  {formatCurrency(selectedTotal, baseCurrency)}
                </span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
