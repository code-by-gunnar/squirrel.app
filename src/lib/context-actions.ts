"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { CONTEXT_COOKIE } from "@/lib/contexts";

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Persist the active context selection. Value is "all" | "unassigned" | "<id>". */
export async function setActiveContext(value: string): Promise<void> {
  const safe = value === "all" || value === "unassigned" || /^\d+$/.test(value)
    ? value
    : "all";
  (await cookies()).set(CONTEXT_COOKIE, safe, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR,
  });
  revalidatePath("/");
  revalidatePath("/subscriptions");
  revalidatePath("/calendar");
  revalidatePath("/reports");
}
