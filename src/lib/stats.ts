import "server-only";
import type { EnrichedSubscription } from "@/lib/subscriptions";

export type CategorySpend = {
  name: string;
  color: string;
  monthly: number;
};

export type DashboardStats = {
  activeCount: number;
  monthlyTotal: number;
  yearlyTotal: number;
  byCategory: CategorySpend[];
  upcoming: EnrichedSubscription[];
};

/**
 * Aggregate active subscriptions into the figures the dashboard renders.
 * All monetary values are already in the base currency (see listSubscriptions).
 */
export function computeDashboardStats(
  subs: EnrichedSubscription[],
): DashboardStats {
  const active = subs.filter((s) => s.active);

  const monthlyTotal = active.reduce((sum, s) => sum + s.monthlyBase, 0);
  const yearlyTotal = active.reduce((sum, s) => sum + s.yearlyBase, 0);

  const categoryMap = new Map<string, CategorySpend>();
  for (const s of active) {
    const name = s.categoryName ?? "Uncategorised";
    const color = s.categoryColor ?? "#64748b";
    const entry = categoryMap.get(name) ?? { name, color, monthly: 0 };
    entry.monthly += s.monthlyBase;
    categoryMap.set(name, entry);
  }
  const byCategory = [...categoryMap.values()].sort((a, b) => b.monthly - a.monthly);

  const upcoming = [...active]
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 5);

  return { activeCount: active.length, monthlyTotal, yearlyTotal, byCategory, upcoming };
}
