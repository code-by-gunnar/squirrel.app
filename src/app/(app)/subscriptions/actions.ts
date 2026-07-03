"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { BILLING_CYCLES } from "@/lib/billing";
import {
  fetchLogoDataUri,
  searchLogoCandidates,
  type LogoCandidate,
} from "@/lib/logo";

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" ? Number(v) : null))
  .refine((v) => v === null || Number.isInteger(v), "Invalid selection");

const SubscriptionSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  url: optionalString,
  logoUrl: optionalString,
  price: z.coerce.number().positive("Price must be greater than 0"),
  currencyCode: z.string().trim().length(3).toUpperCase(),
  billingCycle: z.enum(BILLING_CYCLES as [string, ...string[]]),
  billingInterval: z.coerce.number().int().min(1).max(365),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  trialEndDate: z
    .string()
    .optional()
    .transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)),
  categoryId: optionalId,
  paymentMethodId: optionalId,
  notes: optionalString,
  active: z.boolean(),
  notify: z.boolean(),
});

export type SaveState = { ok?: boolean; error?: string };

function parseCheckbox(fd: FormData, name: string): boolean {
  // Unchecked switches/checkboxes are absent from FormData entirely.
  // Return a concrete boolean — never undefined — so an unchecked switch
  // persists as `false` instead of falling back to a schema default of `true`.
  return fd.get(name) != null;
}

export async function saveSubscription(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const idRaw = formData.get("id");
  const id = idRaw ? Number(idRaw) : null;

  const parsed = SubscriptionSchema.safeParse({
    name: formData.get("name"),
    url: formData.get("url"),
    logoUrl: formData.get("logoUrl"),
    price: formData.get("price"),
    currencyCode: formData.get("currencyCode"),
    billingCycle: formData.get("billingCycle"),
    billingInterval: formData.get("billingInterval"),
    startDate: formData.get("startDate"),
    trialEndDate: formData.get("trialEndDate"),
    categoryId: formData.get("categoryId"),
    paymentMethodId: formData.get("paymentMethodId"),
    notes: formData.get("notes"),
    active: parseCheckbox(formData, "active"),
    notify: parseCheckbox(formData, "notify"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const values = parsed.data;

  // Auto-fetch a logo when the user hasn't provided/kept one.
  if (!values.logoUrl) {
    values.logoUrl = await fetchLogoDataUri(values.name, values.url);
  }

  try {
    if (id) {
      db.update(subscriptions).set(values).where(eq(subscriptions.id, id)).run();
    } else {
      db.insert(subscriptions).values(values).run();
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save" };
  }

  revalidatePath("/subscriptions");
  revalidatePath("/");
  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteSubscription(id: number): Promise<SaveState> {
  try {
    db.delete(subscriptions).where(eq(subscriptions.id, id)).run();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to delete" };
  }
  revalidatePath("/subscriptions");
  revalidatePath("/");
  revalidatePath("/calendar");
  return { ok: true };
}

export async function toggleActive(id: number, active: boolean): Promise<SaveState> {
  db.update(subscriptions).set({ active }).where(eq(subscriptions.id, id)).run();
  revalidatePath("/subscriptions");
  revalidatePath("/");
  return { ok: true };
}

/** Manually look up a logo for the add/edit form (preview before saving). */
export async function fetchLogo(
  name: string,
  url: string,
): Promise<{ logoUrl?: string; error?: string }> {
  if (!name.trim() && !url.trim()) return { error: "Enter a name or website first" };
  const logoUrl = await fetchLogoDataUri(name, url || null);
  return logoUrl ? { logoUrl } : { error: "No logo found — try adding the website" };
}

/** Return several logo candidates for a query so the user can pick one. */
export async function searchLogos(
  query: string,
): Promise<{ candidates?: LogoCandidate[]; error?: string }> {
  if (!query.trim()) return { error: "Type a name, domain, or website to search" };
  const candidates = await searchLogoCandidates(query);
  return candidates.length ? { candidates } : { error: "No logos found for that search" };
}
