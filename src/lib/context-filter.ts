/** Which subscriptions to include when listing: a context id, only untagged, or all. */
export type ContextFilter = number | "all" | "unassigned";

/**
 * Map a raw cookie value to a safe filter. Pure so it is unit-testable and can
 * never trust a stale/hand-edited cookie: an id that is not currently live
 * degrades to "all" rather than showing an empty app.
 */
export function resolveContextFilter(
  raw: string | undefined,
  liveIds: Set<number>,
): ContextFilter {
  if (raw === "unassigned") return "unassigned";
  if (raw && /^\d+$/.test(raw)) {
    const id = Number(raw);
    if (liveIds.has(id)) return id;
  }
  return "all";
}
