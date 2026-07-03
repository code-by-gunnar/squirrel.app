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
  // "Active" here means effective-active: live subs plus cancelled-but-not-yet-
  // expired ones (still usable and still counted until their end date).
  const active = subs.filter((s) => s.isActive);
  // Free-tier subs are active but generate no spend, so they're left out of the
  // monetary aggregations (but still counted as active subscriptions).
  const paid = active.filter((s) => !s.free);

  const monthlyTotal = paid.reduce((sum, s) => sum + s.monthlyBase, 0);
  const yearlyTotal = paid.reduce((sum, s) => sum + s.yearlyBase, 0);

  const categoryMap = new Map<string, CategorySpend>();
  for (const s of paid) {
    const name = s.categoryName ?? "Uncategorised";
    const color = s.categoryColor ?? "#64748b";
    const entry = categoryMap.get(name) ?? { name, color, monthly: 0 };
    entry.monthly += s.monthlyBase;
    categoryMap.set(name, entry);
  }
  const byCategory = [...categoryMap.values()].sort((a, b) => b.monthly - a.monthly);

  // Only subs that actually bill belong in "upcoming renewals" — exclude
  // cancelled (won't renew) and free (no billing).
  const upcoming = active
    .filter((s) => s.status === "active" && !s.free)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 5);

  return { activeCount: active.length, monthlyTotal, yearlyTotal, byCategory, upcoming };
}
