import "server-only";
import { cookies } from "next/headers";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { isNull, eq } from "drizzle-orm";
import { getContexts } from "@/lib/subscriptions";
import { resolveContextFilter, type ContextFilter } from "@/lib/context-filter";

export const CONTEXT_COOKIE = "squirrel_context";

// Re-export so callers can import the filter type + pure resolver from here too.
export type { ContextFilter };
export { resolveContextFilter };

/** Read the active context from the cookie, validated against live contexts. */
export async function getActiveContextFilter(): Promise<ContextFilter> {
  const raw = (await cookies()).get(CONTEXT_COOKIE)?.value;
  const liveIds = new Set(getContexts().map((c) => c.id));
  return resolveContextFilter(raw, liveIds);
}

/**
 * The subscription ids in scope for a filter, or `null` for "all" (meaning: do
 * not filter). Used by the payments-ledger queries in Reports, which have no
 * context column of their own and must scope via subscription_id.
 */
export function subscriptionIdsForContext(filter: ContextFilter): number[] | null {
  if (filter === "all") return null;
  const rows = db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      filter === "unassigned"
        ? isNull(subscriptions.contextId)
        : eq(subscriptions.contextId, filter),
    )
    .all();
  return rows.map((r) => r.id);
}
