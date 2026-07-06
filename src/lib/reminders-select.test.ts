import { describe, it, expect } from "vitest";
import { selectReminders } from "./reminders-select";

type S = Parameters<typeof selectReminders>[0][number] & { name: string };
function sub(over: Partial<S>): S {
  return {
    name: "x", status: "active", free: false, prepaid: false, notify: true,
    daysUntil: 99, depletesOn: null, daysUntilDepletion: null, ...over,
  } as S;
}

describe("selectReminders", () => {
  const lead = 3;

  it("picks recurring subs renewing at exactly lead or today, excluding prepaid/free", () => {
    const subs = [
      sub({ name: "A", daysUntil: 3 }),         // lead → in
      sub({ name: "B", daysUntil: 0 }),         // today → in
      sub({ name: "C", daysUntil: 5 }),         // out
      sub({ name: "D", free: true, daysUntil: 0 }),      // free → out
      sub({ name: "E", prepaid: true, daysUntil: 0 }),   // prepaid → not a renewal
    ];
    const { renewals } = selectReminders(subs, lead);
    expect(renewals.map((s) => s.name)).toEqual(["A", "B"]);
  });

  it("picks prepaid subs running out at exactly lead or today", () => {
    const subs = [
      sub({ name: "P1", prepaid: true, depletesOn: "2099-01-04", daysUntilDepletion: 3 }),  // lead → in
      sub({ name: "P2", prepaid: true, depletesOn: "2099-01-01", daysUntilDepletion: 0 }),  // today → in
      sub({ name: "P3", prepaid: true, depletesOn: "2099-01-10", daysUntilDepletion: 9 }),  // out
      sub({ name: "P4", prepaid: true, depletesOn: null, daysUntilDepletion: null }), // no estimate → out
      sub({ name: "P5", prepaid: true, depletesOn: "2099-01-04", daysUntilDepletion: 3, notify: false }), // muted → out
    ];
    const { topups } = selectReminders(subs, lead);
    expect(topups.map((s) => s.name)).toEqual(["P1", "P2"]);
  });
});
