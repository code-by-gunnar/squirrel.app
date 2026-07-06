import { describe, it, expect } from "vitest";
import { computeDashboardStats } from "./stats";
import type { EnrichedSubscription } from "./subscriptions";

function sub(over: Partial<EnrichedSubscription>): EnrichedSubscription {
  return {
    id: 1, name: "x", logoUrl: null, url: null, price: 10, currencyCode: "GBP",
    billingCycle: "month", billingInterval: 1, startDate: "2026-01-01",
    trialEndDate: null, categoryId: null, paymentMethodId: null, contextId: null,
    notes: null, active: true, notify: true, free: false, cancelled: false,
    endsOn: null, prepaid: false, depletesOn: null, createdAt: "",
    categoryName: null, categoryColor: null, contextName: null, contextColor: null,
    paymentMethodName: null, nextRenewal: "2026-02-01", daysUntil: 5,
    priceBase: 10, monthlyBase: 10, yearlyBase: 120,
    status: "active", isActive: true, daysUntilEnd: null,
    daysUntilDepletion: null, depleted: false,
    ...over,
  } as EnrichedSubscription;
}

describe("computeDashboardStats with prepaid", () => {
  it("excludes prepaid from monthly/yearly totals and upcoming, keeps it in the count", () => {
    const subs = [
      sub({ id: 1, name: "Netflix", monthlyBase: 10, yearlyBase: 120 }),
      sub({ id: 2, name: "Credits", prepaid: true, monthlyBase: 0, yearlyBase: 0, daysUntil: 3 }),
    ];
    const stats = computeDashboardStats(subs);
    expect(stats.monthlyTotal).toBe(10);       // only Netflix
    expect(stats.yearlyTotal).toBe(120);
    expect(stats.activeCount).toBe(2);          // both counted as active
    expect(stats.upcoming.map((s) => s.name)).not.toContain("Credits");
    expect(stats.byCategory.length).toBe(1);    // prepaid not in category breakdown
  });
});
