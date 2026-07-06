/** The minimal fields the reminder selector needs from an enriched subscription. */
type Remindable = {
  status: string;
  free: boolean;
  prepaid: boolean;
  notify: boolean;
  daysUntil: number;
  depletesOn: string | null;
  daysUntilDepletion: number | null;
};

/**
 * Split reminder-eligible subs into recurring renewals and prepaid top-ups.
 * A sub is due when it lands exactly on the lead day (the heads-up) or today
 * (the day-of) — the same clean cadence for both kinds, so neither nags.
 */
export function selectReminders<T extends Remindable>(
  subs: T[],
  lead: number,
): { renewals: T[]; topups: T[] } {
  const renewals = subs.filter(
    (s) =>
      s.status === "active" &&
      !s.free &&
      !s.prepaid &&
      s.notify &&
      (s.daysUntil === lead || s.daysUntil === 0),
  );
  const topups = subs.filter(
    (s) =>
      s.prepaid &&
      s.notify &&
      s.depletesOn !== null &&
      (s.daysUntilDepletion === lead || s.daysUntilDepletion === 0),
  );
  return { renewals, topups };
}
