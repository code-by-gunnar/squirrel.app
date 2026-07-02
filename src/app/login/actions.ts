"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";

export type LoginState = { error?: string };

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");

  if (!verifyPassword(password)) {
    return { error: "Incorrect password." };
  }

  const token = await createSessionToken();
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions);
  redirect("/");
}

export async function logout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
