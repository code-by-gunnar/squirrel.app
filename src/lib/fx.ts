import "server-only";
import { db } from "@/db";
import { fxRates } from "@/db/schema";
import { getBaseCurrency } from "@/lib/settings";

/**
 * Frankfurter returns rates as "1 base = N foreign". We store the inverse
 * (rateToBase = "1 foreign = M base") so convertToBase() is a simple multiply.
 * Free, no API key, ECB reference rates updated on working days.
 */
const FX_API = process.env.FX_API_URL ?? "https://api.frankfurter.app/latest";
// Host without the "/latest" path, so we can also hit the time-series endpoint.
const FX_HOST = FX_API.replace(/\/latest\/?$/, "");

type FrankfurterResponse = {
  base: string;
  date: string;
  rates: Record<string, number>;
};

type FrankfurterSeriesResponse = {
  base: string;
  start_date: string;
  end_date: string;
  rates: Record<string, Record<string, number>>;
};

export async function refreshFxRates(): Promise<{ ok: boolean; error?: string }> {
  const base = getBaseCurrency();
  const url = `${FX_API}?from=${encodeURIComponent(base)}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { ok: false, error: `FX API ${res.status}` };
    const data = (await res.json()) as FrankfurterResponse;

    const now = new Date().toISOString();
    const rows = [
      { code: base, rateToBase: 1, fetchedAt: now },
      ...Object.entries(data.rates).map(([code, perBase]) => ({
        code,
        rateToBase: perBase > 0 ? 1 / perBase : 0,
        fetchedAt: now,
      })),
    ];

    db.transaction((tx) => {
      for (const row of rows) {
        tx
          .insert(fxRates)
          .values(row)
          .onConflictDoUpdate({
            target: fxRates.code,
            set: { rateToBase: row.rateToBase, fetchedAt: row.fetchedAt },
          })
          .run();
      }
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "FX fetch failed" };
  }
}

/**
 * Historical "1 unit of `code` = N base" rates for every working day in
 * [startISO, endISO], from Frankfurter's time-series endpoint (one request).
 * Returns a map keyed by ISO date. Empty when `code === base` (caller uses 1).
 * ECB publishes no rate on weekends/holidays, so those dates are absent — use
 * `rateForDate()` to fall back to the nearest prior available day.
 */
export async function getRatesForRange(
  code: string,
  base: string,
  startISO: string,
  endISO: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (code === base) return out;

  const url = `${FX_HOST}/${startISO}..${endISO}?from=${encodeURIComponent(
    base,
  )}&to=${encodeURIComponent(code)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`FX series API ${res.status}`);
  const data = (await res.json()) as FrankfurterSeriesResponse;

  for (const [date, rates] of Object.entries(data.rates ?? {})) {
    const perBase = rates[code];
    if (perBase && perBase > 0) out.set(date, 1 / perBase);
  }
  return out;
}
