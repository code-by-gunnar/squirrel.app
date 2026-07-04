import { describe, it, expect } from "vitest";
import { parseBackup } from "./backup";

function validBackup() {
  return {
    app: "squirrel",
    schema: 1,
    appVersion: "1.6.0",
    exportedAt: "2026-07-04T12:00:00.000Z",
    data: {
      settings: [{ key: "base_currency", value: "GBP" }],
      categories: [{ id: 1, name: "Software", color: "#6366f1" }],
      paymentMethods: [{ id: 1, name: "Debit Card" }],
      subscriptions: [
        {
          id: 5,
          name: "Spotify",
          logoUrl: null,
          url: null,
          price: 11.99,
          currencyCode: "GBP",
          billingCycle: "month",
          billingInterval: 1,
          startDate: "2025-08-01",
          trialEndDate: null,
          categoryId: 1,
          paymentMethodId: 1,
          notes: null,
          active: true,
          notify: true,
          free: false,
          cancelled: false,
          endsOn: null,
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      ],
      payments: [
        {
          id: 1,
          subscriptionId: 5,
          paidOn: "2026-07-01",
          amount: 11.99,
          currencyCode: "GBP",
          amountBase: 11.99,
          baseCurrency: "GBP",
          fxRate: 1,
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    },
  };
}

describe("parseBackup", () => {
  it("accepts a well-formed backup and returns typed data", () => {
    const res = parseBackup(JSON.stringify(validBackup()));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.data.subscriptions[0].name).toBe("Spotify");
      expect(res.data.data.payments[0].subscriptionId).toBe(5);
    }
  });

  it("rejects non-JSON text", () => {
    const res = parseBackup("not json {");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/JSON/i);
  });

  it("rejects a missing data section", () => {
    const res = parseBackup(JSON.stringify({ schema: 1 }));
    expect(res.ok).toBe(false);
  });

  it("rejects wrong types (price as string)", () => {
    const bad = validBackup();
    // @ts-expect-error deliberately corrupt the type
    bad.data.subscriptions[0].price = "free";
    const res = parseBackup(JSON.stringify(bad));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/price/);
  });

  it("ignores unknown extra fields (forward-compatible)", () => {
    const withExtra = validBackup() as Record<string, unknown>;
    withExtra.futureField = { anything: true };
    const res = parseBackup(JSON.stringify(withExtra));
    expect(res.ok).toBe(true);
  });
});
