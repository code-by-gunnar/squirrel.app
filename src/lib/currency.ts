import type { FxRate } from "@/db/schema";

/** A small, non-exhaustive set of common currency symbols for display. */
const SYMBOLS: Record<string, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
  JPY: "¥",
  AUD: "A$",
  CAD: "C$",
  CHF: "CHF ",
  CNY: "¥",
  INR: "₹",
  BRL: "R$",
  SEK: "kr ",
  NOK: "kr ",
  DKK: "kr ",
  NZD: "NZ$",
  ZAR: "R ",
};

/** Currency codes offered in dropdowns. */
export const COMMON_CURRENCIES = [
  "GBP", "USD", "EUR", "JPY", "AUD", "CAD", "CHF", "CNY",
  "INR", "BRL", "SEK", "NOK", "DKK", "NZD", "ZAR", "SGD", "HKD", "PLN",
] as const;

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? `${code} `;
}

/** Format an amount using Intl, falling back gracefully for odd codes. */
export function formatCurrency(amount: number, code: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencySymbol(code)}${amount.toFixed(2)}`;
  }
}

/**
 * Convert an amount from `code` into the base currency using cached rates,
 * where each rate expresses "1 unit of `code` = rateToBase base units".
 * The base currency (rate 1) may be absent from the map; treat it as identity.
 */
export function convertToBase(
  amount: number,
  code: string,
  baseCurrency: string,
  rates: Map<string, number>,
): number {
  if (code === baseCurrency) return amount;
  const rate = rates.get(code);
  if (rate == null) return amount; // unknown rate: assume already in base
  return amount * rate;
}

export function ratesToMap(rows: FxRate[]): Map<string, number> {
  return new Map(rows.map((r) => [r.code, r.rateToBase]));
}
