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

  it("accepts a backup containing contexts", () => {
    const backup = {
      app: "squirrel",
      schema: 1,
      data: {
        settings: [],
        categories: [],
        contexts: [{ id: 1, name: "Work", color: "#0ea5e9" }],
        paymentMethods: [],
        subscriptions: [
          {
            id: 1, name: "Figma", logoUrl: null, url: null, price: 12,
            currencyCode: "USD", billingCycle: "month", billingInterval: 1,
            startDate: "2024-01-01", trialEndDate: null, categoryId: null,
            contextId: 1, paymentMethodId: null, notes: null, active: true,
            notify: true, free: false, cancelled: false, endsOn: null,
            createdAt: "2024-01-01T00:00:00.000Z",
          },
        ],
        payments: [],
      },
    };
    const res = parseBackup(JSON.stringify(backup));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.data.contexts[0].name).toBe("Work");
      expect(res.data.data.subscriptions[0].contextId).toBe(1);
    }
  });

  it("round-trips prepaid + depletesOn and defaults them for old backups", () => {
    const withPrepaid = {
      app: "squirrel", schema: 1,
      data: {
        settings: [], categories: [], contexts: [], paymentMethods: [], payments: [],
        subscriptions: [{
          id: 1, name: "Credits", logoUrl: null, url: null, price: 50,
          currencyCode: "GBP", billingCycle: "month", billingInterval: 1,
          startDate: "2026-01-01", trialEndDate: null, categoryId: null,
          contextId: null, paymentMethodId: null, notes: null, active: true,
          notify: true, free: false, cancelled: false, endsOn: null,
          prepaid: true, depletesOn: "2026-03-01", createdAt: "2026-01-01T00:00:00.000Z",
        }],
      },
    };
    const res = parseBackup(JSON.stringify(withPrepaid));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.data.subscriptions[0].prepaid).toBe(true);
      expect(res.data.data.subscriptions[0].depletesOn).toBe("2026-03-01");
    }

    // Old backup shape: no prepaid/depletesOn keys on the subscription.
    const old = JSON.parse(JSON.stringify(withPrepaid));
    delete old.data.subscriptions[0].prepaid;
    delete old.data.subscriptions[0].depletesOn;
    const res2 = parseBackup(JSON.stringify(old));
    expect(res2.ok).toBe(true);
    if (res2.ok) {
      expect(res2.data.data.subscriptions[0].prepaid).toBe(false);
      expect(res2.data.data.subscriptions[0].depletesOn).toBeNull();
    }
  });
});
