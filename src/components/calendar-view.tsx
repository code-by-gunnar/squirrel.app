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
import { SubscriptionLogo } from "@/components/subscription-logo";
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
    // Only subs that actually renew — exclude cancelled (stopped) and free (no billing).
    const active = subscriptions.filter((s) => s.status === "active" && !s.free);
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
  const viewingCurrentMonth = isSameMonth(cursor, new Date());

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">When your subscriptions renew.</p>
        </div>
        <div className="relative flex items-center justify-center gap-2 sm:justify-end">
          <Button variant="outline" size="icon" onClick={() => setCursor(subMonths(cursor, 1))} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-32 text-center text-sm font-medium">
            {format(cursor, "MMMM yyyy")}
          </span>
          <Button variant="outline" size="icon" onClick={() => setCursor(addMonths(cursor, 1))} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
          {/* Only shown once you've navigated away from the current month, so it
              never sits there looking like inert text. Absolute on mobile so the
              month label stays dead-centre; inline on desktop. */}
          {!viewingCurrentMonth ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCursor(startOfMonth(new Date()))}
              className="absolute right-0 sm:static"
            >
              Today
            </Button>
          ) : null}
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
                    aria-current={isSelected ? "date" : undefined}
                    className={cn(
                      "relative flex aspect-square items-center justify-center rounded-xl text-sm transition-colors",
                      inMonth ? "text-foreground" : "text-muted-foreground/40",
                      isSelected && !isToday ? "bg-primary/10" : "hover:bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full transition-colors",
                        isToday
                          ? "bg-primary font-semibold text-primary-foreground"
                          : isSelected
                            ? "font-semibold text-primary"
                            : "",
                      )}
                    >
                      {format(day, "d")}
                    </span>
                    {entries.length > 0 ? (
                      <div className="absolute inset-x-0 bottom-1 flex items-center justify-center gap-0.5">
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
                  <SubscriptionLogo
                    name={sub.name}
                    logoUrl={sub.logoUrl}
                    color={sub.categoryColor}
                  />
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
