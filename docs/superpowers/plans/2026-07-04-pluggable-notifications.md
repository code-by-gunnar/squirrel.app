# Pluggable Notification Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep ntfy as the default reminder channel but make the transport pluggable, adding Telegram and Email as independently toggleable channels that reminders fan out to, plus a bundled self-hosted ntfy service in the Compose stack.

**Architecture:** A channel registry. Each channel is a `NotificationChannel` object (`isEnabled`/`isConfigured`/`send`). A dispatcher (`notifyAll`) loops the registry and sends to every enabled + configured channel. Pure formatting/validation lives in `payloads.ts` (vitest-tested); server-only IO (fetch/nodemailer) lives in `index.ts`. Settings stay in the existing key/value table — no schema migration.

**Tech Stack:** Next.js 16 (App Router, server actions), TypeScript, Drizzle/better-sqlite3, zod v4, Base UI (shadcn), nodemailer, vitest, node-cron.

## Global Constraints

- **Version bump:** `package.json` `version` `1.6.0` → `1.7.0` (shown in the footer via `@/lib/version`).
- **Base UI, not Radix:** shadcn components wrap `@base-ui/react`. Switch API is `checked` / `onCheckedChange(checked: boolean)` / `name`. Select `onValueChange` can yield `null` — coalesce.
- **Purity rule:** `types.ts` and `payloads.ts` must NOT runtime-import a `server-only` module. `AppSettings` (defined in the `server-only` `src/lib/settings.ts`) may only be referenced via `import type`.
- **No DB migration:** all new config is new keys in the existing `settings` key/value table.
- **Behaviour preservation:** an existing ntfy-only deployment (topic set, others blank) must keep working exactly as before. `ntfy_enabled` defaults to `"1"`; a channel only sends when enabled AND configured.
- **Secrets** (`telegram_bot_token`, `email_smtp_pass`) are stored plaintext in the DB (same trust model as the ntfy topic) and ride along in JSON backups. Note this in the UI and README.
- **Test runner:** `npx vitest run <file>` for a single file; `npm test` for all.

---

### Task 1: Notification types + pure payloads/validation (+ widen settings)

Foundation. Pure modules, fully TDD. Also widens `AppSettings` and `DEFAULT_SETTINGS` because the pure predicates and the settings form schema depend on the new keys existing on the type.

**Files:**
- Create: `src/lib/notify/types.ts`
- Create: `src/lib/notify/payloads.ts`
- Create: `src/lib/notify/payloads.test.ts`
- Modify: `src/lib/settings.ts` (widen `AppSettings`, read new keys)
- Modify: `src/db/seed.ts` (add defaults)

**Interfaces:**
- Produces:
  - `type ChannelId = "ntfy" | "telegram" | "email"`
  - `type NotificationMessage = { title: string; message: string; tags?: string[]; priority?: 1|2|3|4|5; clickUrl?: string }`
  - `type ChannelResult = { id: ChannelId; label: string; error: string | null }`
  - `interface NotificationChannel { id; label; isEnabled(s): boolean; isConfigured(s): boolean; send(s, msg): Promise<string|null> }`
  - `const CHANNEL_LABELS: Record<ChannelId, string>`
  - From `payloads.ts`: `buildNtfyPayload`, `buildTelegramPayload`, `buildEmail`, `isNtfyConfigured`, `isTelegramConfigured`, `isEmailConfigured`, `isChannelEnabled(s, id)`, `settingsFormSchema` (zod).

- [ ] **Step 1: Widen `AppSettings` and defaults**

In `src/lib/settings.ts`, extend the `AppSettings` type and the `getSettings()` return object:

```ts
export type AppSettings = {
  base_currency: string;
  notify_lead_days: string;
  theme: string;
  ntfy_enabled: string;
  ntfy_server: string;
  ntfy_topic: string;
  telegram_enabled: string;
  telegram_bot_token: string;
  telegram_chat_id: string;
  email_enabled: string;
  email_smtp_host: string;
  email_smtp_port: string;
  email_smtp_secure: string;
  email_smtp_user: string;
  email_smtp_pass: string;
  email_from: string;
  email_to: string;
};
```

In `getSettings()`, after the existing lines, return the new keys (all `""` fallback except the ntfy ones which already exist):

```ts
  return {
    base_currency: map.get("base_currency") || DEFAULT_SETTINGS.base_currency,
    notify_lead_days: map.get("notify_lead_days") || DEFAULT_SETTINGS.notify_lead_days,
    theme: map.get("theme") || DEFAULT_SETTINGS.theme,
    ntfy_enabled: map.get("ntfy_enabled") ?? DEFAULT_SETTINGS.ntfy_enabled,
    ntfy_server: map.get("ntfy_server") || DEFAULT_SETTINGS.ntfy_server,
    ntfy_topic: map.get("ntfy_topic") ?? DEFAULT_SETTINGS.ntfy_topic,
    telegram_enabled: map.get("telegram_enabled") ?? "",
    telegram_bot_token: map.get("telegram_bot_token") ?? "",
    telegram_chat_id: map.get("telegram_chat_id") ?? "",
    email_enabled: map.get("email_enabled") ?? "",
    email_smtp_host: map.get("email_smtp_host") ?? "",
    email_smtp_port: map.get("email_smtp_port") ?? "",
    email_smtp_secure: map.get("email_smtp_secure") ?? "",
    email_smtp_user: map.get("email_smtp_user") ?? "",
    email_smtp_pass: map.get("email_smtp_pass") ?? "",
    email_from: map.get("email_from") ?? "",
    email_to: map.get("email_to") ?? "",
  };
```

In `src/db/seed.ts`, add to `DEFAULT_SETTINGS` (after `ntfy_topic`):

```ts
  ntfy_enabled: "1",
  ntfy_server: "https://ntfy.sh",
  ntfy_topic: "",
  telegram_enabled: "",
  telegram_bot_token: "",
  telegram_chat_id: "",
  email_enabled: "",
  email_smtp_host: "",
  email_smtp_port: "",
  email_smtp_secure: "",
  email_smtp_user: "",
  email_smtp_pass: "",
  email_from: "",
  email_to: "",
```

(Keep the existing `ntfy_server`/`ntfy_topic` lines — don't duplicate; just add the new keys around them.)

- [ ] **Step 2: Create `src/lib/notify/types.ts`**

```ts
import type { AppSettings } from "@/lib/settings";

export type ChannelId = "ntfy" | "telegram" | "email";

/** Superset message shape; each channel maps down from it. */
export type NotificationMessage = {
  title: string;
  message: string;
  tags?: string[]; // ntfy only
  priority?: 1 | 2 | 3 | 4 | 5; // ntfy only
  clickUrl?: string; // ntfy click action
};

export type ChannelResult = { id: ChannelId; label: string; error: string | null };

export interface NotificationChannel {
  id: ChannelId;
  label: string;
  isEnabled(s: AppSettings): boolean;
  isConfigured(s: AppSettings): boolean;
  /** Returns an error string on failure, or null on success. */
  send(s: AppSettings, msg: NotificationMessage): Promise<string | null>;
}

export const CHANNEL_LABELS: Record<ChannelId, string> = {
  ntfy: "ntfy",
  telegram: "Telegram",
  email: "Email",
};
```

- [ ] **Step 3: Write the failing test `src/lib/notify/payloads.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  buildNtfyPayload,
  buildTelegramPayload,
  buildEmail,
  isNtfyConfigured,
  isTelegramConfigured,
  isEmailConfigured,
  isChannelEnabled,
  settingsFormSchema,
} from "./payloads";
import type { AppSettings } from "@/lib/settings";

const base: AppSettings = {
  base_currency: "GBP", notify_lead_days: "3", theme: "system",
  ntfy_enabled: "1", ntfy_server: "https://ntfy.sh", ntfy_topic: "",
  telegram_enabled: "", telegram_bot_token: "", telegram_chat_id: "",
  email_enabled: "", email_smtp_host: "", email_smtp_port: "", email_smtp_secure: "",
  email_smtp_user: "", email_smtp_pass: "", email_from: "", email_to: "",
};

describe("buildNtfyPayload", () => {
  it("maps message fields and includes optional tags/priority/click", () => {
    const p = buildNtfyPayload("my-topic", {
      title: "T", message: "M", tags: ["moneybag"], priority: 4, clickUrl: "http://x",
    });
    expect(p).toEqual({ topic: "my-topic", title: "T", message: "M", tags: ["moneybag"], priority: 4, click: "http://x" });
  });
  it("omits optional fields when absent", () => {
    expect(buildNtfyPayload("t", { title: "T", message: "M" })).toEqual({ topic: "t", title: "T", message: "M" });
  });
});

describe("buildTelegramPayload", () => {
  it("bolds the title as the first Markdown line", () => {
    expect(buildTelegramPayload("123", { title: "T", message: "M" })).toEqual({
      chat_id: "123", text: "*T*\nM", parse_mode: "Markdown", disable_web_page_preview: true,
    });
  });
});

describe("buildEmail", () => {
  it("maps title to subject and message to text", () => {
    expect(buildEmail("a@x", "b@y", { title: "T", message: "M" })).toEqual({
      from: "a@x", to: "b@y", subject: "T", text: "M",
    });
  });
});

describe("config predicates", () => {
  it("ntfy needs a topic", () => {
    expect(isNtfyConfigured(base)).toBe(false);
    expect(isNtfyConfigured({ ...base, ntfy_topic: "x" })).toBe(true);
  });
  it("telegram needs token and chat id", () => {
    expect(isTelegramConfigured({ ...base, telegram_bot_token: "t" })).toBe(false);
    expect(isTelegramConfigured({ ...base, telegram_bot_token: "t", telegram_chat_id: "c" })).toBe(true);
  });
  it("email needs host, from and to", () => {
    expect(isEmailConfigured({ ...base, email_smtp_host: "h", email_from: "f" })).toBe(false);
    expect(isEmailConfigured({ ...base, email_smtp_host: "h", email_from: "f", email_to: "t" })).toBe(true);
  });
  it("isChannelEnabled reads the flag", () => {
    expect(isChannelEnabled(base, "ntfy")).toBe(true);
    expect(isChannelEnabled(base, "telegram")).toBe(false);
  });
});

describe("settingsFormSchema", () => {
  const raw = {
    base_currency: "gbp", notify_lead_days: "3",
    ntfy_enabled: "1", ntfy_server: "", ntfy_topic: "my-topic",
    telegram_enabled: "", telegram_bot_token: "", telegram_chat_id: "",
    email_enabled: "", email_smtp_host: "", email_smtp_port: "", email_smtp_secure: "",
    email_smtp_user: "", email_smtp_pass: "", email_from: "", email_to: "",
  };
  it("accepts a valid form and upper-cases currency", () => {
    const r = settingsFormSchema.safeParse(raw);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.base_currency).toBe("GBP");
  });
  it("rejects ntfy enabled without a topic", () => {
    const r = settingsFormSchema.safeParse({ ...raw, ntfy_topic: "" });
    expect(r.success).toBe(false);
  });
  it("rejects telegram enabled without token/chat id", () => {
    const r = settingsFormSchema.safeParse({ ...raw, telegram_enabled: "1" });
    expect(r.success).toBe(false);
  });
  it("rejects email enabled without host/from/to", () => {
    const r = settingsFormSchema.safeParse({ ...raw, email_enabled: "1", email_smtp_host: "h" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/lib/notify/payloads.test.ts`
Expected: FAIL — cannot resolve `./payloads`.

- [ ] **Step 5: Create `src/lib/notify/payloads.ts`**

```ts
import { z } from "zod";
import type { AppSettings } from "@/lib/settings";
import type { ChannelId, NotificationMessage } from "./types";

// --- ntfy ---
export function isNtfyConfigured(s: AppSettings): boolean {
  return Boolean(s.ntfy_topic);
}
export function buildNtfyPayload(topic: string, msg: NotificationMessage) {
  const payload: Record<string, unknown> = { topic, title: msg.title, message: msg.message };
  if (msg.tags?.length) payload.tags = msg.tags;
  if (msg.priority) payload.priority = msg.priority;
  if (msg.clickUrl) payload.click = msg.clickUrl;
  return payload;
}

// --- telegram ---
export function isTelegramConfigured(s: AppSettings): boolean {
  return Boolean(s.telegram_bot_token && s.telegram_chat_id);
}
export function buildTelegramPayload(chatId: string, msg: NotificationMessage) {
  return {
    chat_id: chatId,
    text: `*${msg.title}*\n${msg.message}`,
    parse_mode: "Markdown" as const,
    disable_web_page_preview: true,
  };
}

// --- email ---
export function isEmailConfigured(s: AppSettings): boolean {
  return Boolean(s.email_smtp_host && s.email_from && s.email_to);
}
export function buildEmail(from: string, to: string, msg: NotificationMessage) {
  return { from, to, subject: msg.title, text: msg.message };
}

// --- enabled flag ---
export function isChannelEnabled(s: AppSettings, id: ChannelId): boolean {
  return s[`${id}_enabled` as keyof AppSettings] === "1";
}

// --- whole settings form (used by the save action; tested here) ---
export const settingsFormSchema = z
  .object({
    base_currency: z.string().trim().length(3).toUpperCase(),
    notify_lead_days: z.coerce.number().int().min(0).max(60),

    ntfy_enabled: z.coerce.boolean(),
    ntfy_server: z.string().trim().url().or(z.literal("")),
    ntfy_topic: z.string().trim().max(120),

    telegram_enabled: z.coerce.boolean(),
    telegram_bot_token: z.string().trim().max(200),
    telegram_chat_id: z.string().trim().max(64),

    email_enabled: z.coerce.boolean(),
    email_smtp_host: z.string().trim().max(255),
    email_smtp_port: z.string().trim().max(6),
    email_smtp_secure: z.coerce.boolean(),
    email_smtp_user: z.string().trim().max(255),
    email_smtp_pass: z.string().max(255),
    email_from: z.string().trim().max(255),
    email_to: z.string().trim().max(255),
  })
  .superRefine((v, ctx) => {
    if (v.ntfy_enabled && !v.ntfy_topic) {
      ctx.addIssue({ code: "custom", path: ["ntfy_topic"], message: "ntfy topic is required when ntfy is on." });
    }
    if (v.telegram_enabled && (!v.telegram_bot_token || !v.telegram_chat_id)) {
      ctx.addIssue({ code: "custom", path: ["telegram_chat_id"], message: "Telegram needs a bot token and chat id when on." });
    }
    if (v.email_enabled && (!v.email_smtp_host || !v.email_from || !v.email_to)) {
      ctx.addIssue({ code: "custom", path: ["email_smtp_host"], message: "Email needs SMTP host, from and to addresses when on." });
    }
  });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/notify/payloads.test.ts`
Expected: PASS (all cases). Then `npx tsc --noEmit` — Expected: no errors (settings type widened, no server-only import in pure modules).

- [ ] **Step 7: Commit**

```bash
git add src/lib/notify/types.ts src/lib/notify/payloads.ts src/lib/notify/payloads.test.ts src/lib/settings.ts src/db/seed.ts
git commit -m "feat(notify): add channel types + pure payloads/validation, widen settings"
```

---

### Task 2: Channel senders, registry, dispatcher (server-only)

Adds the IO layer and the registry, migrating `src/lib/notify.ts` into `src/lib/notify/index.ts`. Installs `nodemailer`. Not vitest-tested (server-only fetch/nodemailer) — gated by typecheck/build; selection logic was already tested purely in Task 1.

**Files:**
- Create: `src/lib/notify/index.ts`
- Delete: `src/lib/notify.ts`
- Modify: `package.json` (add deps)

**Interfaces:**
- Consumes: everything from Task 1 (`payloads.ts`, `types.ts`).
- Produces:
  - `sendNtfy(server: string, topic: string, msg: NotificationMessage): Promise<string|null>` (kept from old `notify.ts`)
  - `notifyAll(s: AppSettings, msg: NotificationMessage): Promise<ChannelResult[]>`
  - `channelById(id: ChannelId): NotificationChannel | undefined`
  - `hasActiveChannel(s: AppSettings): boolean`
  - `detectTelegramChatId(token: string): Promise<{ chatId?: string; error?: string }>`
  - `const CHANNELS: NotificationChannel[]`

- [ ] **Step 1: Install nodemailer**

Run:
```bash
npm install nodemailer@^6 && npm install -D @types/nodemailer@^6
```
Expected: `package.json` gains `nodemailer` (deps) and `@types/nodemailer` (devDeps).

- [ ] **Step 2: Create `src/lib/notify/index.ts`**

```ts
import "server-only";
import nodemailer from "nodemailer";
import type { AppSettings } from "@/lib/settings";
import {
  type ChannelId,
  type ChannelResult,
  type NotificationChannel,
  type NotificationMessage,
  CHANNEL_LABELS,
} from "./types";
import {
  buildEmail,
  buildNtfyPayload,
  buildTelegramPayload,
  isChannelEnabled,
  isEmailConfigured,
  isNtfyConfigured,
  isTelegramConfigured,
} from "./payloads";

/**
 * Publish to an ntfy topic. Kept as a standalone export (its signature predates
 * the registry) so existing call sites keep working. Uses ntfy's JSON API so
 * UTF-8 titles (accents/emoji) survive — headers must be ASCII.
 */
export async function sendNtfy(
  server: string,
  topic: string,
  msg: NotificationMessage,
): Promise<string | null> {
  if (!topic) return "No ntfy topic configured.";
  const baseUrl = (server || "https://ntfy.sh").replace(/\/+$/, "");
  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildNtfyPayload(topic, msg)),
    });
    if (!res.ok) return `ntfy responded ${res.status} ${res.statusText}`;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Failed to reach ntfy server";
  }
}

async function sendTelegram(s: AppSettings, msg: NotificationMessage): Promise<string | null> {
  const url = `https://api.telegram.org/bot${s.telegram_bot_token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildTelegramPayload(s.telegram_chat_id, msg)),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { description?: string } | null;
      return `Telegram error: ${body?.description ?? `${res.status} ${res.statusText}`}`;
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Failed to reach Telegram";
  }
}

async function sendEmail(s: AppSettings, msg: NotificationMessage): Promise<string | null> {
  try {
    const port = Number(s.email_smtp_port) || 587;
    const transport = nodemailer.createTransport({
      host: s.email_smtp_host,
      port,
      secure: s.email_smtp_secure === "1",
      auth: s.email_smtp_user ? { user: s.email_smtp_user, pass: s.email_smtp_pass } : undefined,
    });
    await transport.sendMail(buildEmail(s.email_from, s.email_to, msg));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Failed to send email";
  }
}

export const CHANNELS: NotificationChannel[] = [
  {
    id: "ntfy",
    label: CHANNEL_LABELS.ntfy,
    isEnabled: (s) => isChannelEnabled(s, "ntfy"),
    isConfigured: isNtfyConfigured,
    send: (s, m) => sendNtfy(s.ntfy_server, s.ntfy_topic, m),
  },
  {
    id: "telegram",
    label: CHANNEL_LABELS.telegram,
    isEnabled: (s) => isChannelEnabled(s, "telegram"),
    isConfigured: isTelegramConfigured,
    send: sendTelegram,
  },
  {
    id: "email",
    label: CHANNEL_LABELS.email,
    isEnabled: (s) => isChannelEnabled(s, "email"),
    isConfigured: isEmailConfigured,
    send: sendEmail,
  },
];

export function channelById(id: ChannelId): NotificationChannel | undefined {
  return CHANNELS.find((c) => c.id === id);
}

export function hasActiveChannel(s: AppSettings): boolean {
  return CHANNELS.some((c) => c.isEnabled(s) && c.isConfigured(s));
}

/** Send to every enabled+configured channel. One channel failing never blocks another. */
export async function notifyAll(
  s: AppSettings,
  msg: NotificationMessage,
): Promise<ChannelResult[]> {
  const results: ChannelResult[] = [];
  for (const ch of CHANNELS) {
    if (!ch.isEnabled(s) || !ch.isConfigured(s)) continue;
    let error: string | null;
    try {
      error = await ch.send(s, msg);
    } catch (e) {
      error = e instanceof Error ? e.message : "Channel send failed";
    }
    results.push({ id: ch.id, label: ch.label, error });
  }
  return results;
}

/** Read the most recent chat id from the bot's pending updates (friction reducer). */
export async function detectTelegramChatId(
  token: string,
): Promise<{ chatId?: string; error?: string }> {
  if (!token) return { error: "Enter a bot token first." };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; result?: Array<Record<string, unknown>> }
      | null;
    if (!res.ok || !body?.ok) return { error: "Could not reach Telegram. Check the token." };
    const updates = body.result ?? [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i] as { message?: { chat?: { id?: number } }; channel_post?: { chat?: { id?: number } } };
      const id = u.message?.chat?.id ?? u.channel_post?.chat?.id;
      if (id != null) return { chatId: String(id) };
    }
    return { error: "No messages found. Send your bot a message, then retry." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to reach Telegram" };
  }
}
```

- [ ] **Step 3: Delete the old module**

Run:
```bash
git rm src/lib/notify.ts
```
Expected: `src/lib/notify.ts` removed; `@/lib/notify` now resolves to the folder's `index.ts`.

- [ ] **Step 4: Verify typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors. (Note: `src/app/(app)/settings/actions.ts` still imports `sendNtfy` from `@/lib/notify` — that export still exists, so it compiles. Its logic is rewired in Task 3.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/notify/index.ts package.json package-lock.json
git commit -m "feat(notify): channel registry, dispatcher, email/telegram senders"
```

---

### Task 3: Wire reminders + server actions to the fan-out

Route the daily reminder and the settings actions through `notifyAll` / the registry.

**Files:**
- Modify: `src/lib/reminders.ts`
- Modify: `src/app/(app)/settings/actions.ts`

**Interfaces:**
- Consumes: `notifyAll`, `channelById`, `hasActiveChannel`, `detectTelegramChatId`, `CHANNELS` (Task 2); `settingsFormSchema` (Task 1).
- Produces:
  - `runDailyReminders(): Promise<{ sent: number; results: ChannelResult[]; error?: string }>`
  - `sendTestNotification(channelId: ChannelId): Promise<ActionState>` (signature changed — now takes a channel id)
  - `detectTelegramChatId(token: string): Promise<{ chatId?: string; error?: string }>` (server action)

- [ ] **Step 1: Rewrite `runDailyReminders` in `src/lib/reminders.ts`**

Replace the whole file body with:

```ts
import "server-only";
import { listSubscriptions } from "@/lib/subscriptions";
import { getSettings } from "@/lib/settings";
import { formatCurrency } from "@/lib/currency";
import { CHANNELS, notifyAll } from "@/lib/notify";
import type { ChannelResult } from "@/lib/notify/types";

/**
 * Send renewal reminders to every enabled+configured channel. A subscription is
 * only included when it renews exactly `lead_days` from now (the heads-up) or
 * today (the day-of reminder). Runs once per day from the scheduler.
 */
export async function runDailyReminders(): Promise<{
  sent: number;
  results: ChannelResult[];
  error?: string;
}> {
  const settings = getSettings();
  const lead = Number(settings.notify_lead_days) || 0;

  const anyActive = CHANNELS.some((c) => c.isEnabled(settings) && c.isConfigured(settings));
  if (!anyActive) return { sent: 0, results: [], error: "No notification channel enabled" };

  const due = listSubscriptions().filter(
    (s) =>
      s.status === "active" &&
      !s.free &&
      s.notify &&
      (s.daysUntil === lead || s.daysUntil === 0),
  );

  if (due.length === 0) return { sent: 0, results: [] };

  const lines = due.map((s) => {
    const when = s.daysUntil === 0 ? "today" : `in ${s.daysUntil} days`;
    return `• ${s.name} — ${formatCurrency(s.price, s.currencyCode)} ${when} (${s.nextRenewal})`;
  });

  const title =
    due.length === 1
      ? `${due[0].name} renews ${due[0].daysUntil === 0 ? "today" : `in ${due[0].daysUntil} days`}`
      : `${due.length} subscriptions renewing soon`;

  const results = await notifyAll(settings, {
    title,
    message: lines.join("\n"),
    tags: ["moneybag"],
    priority: 4,
  });

  const delivered = results.some((r) => r.error === null);
  const firstError = results.find((r) => r.error)?.error;
  return {
    sent: delivered ? due.length : 0,
    results,
    error: delivered ? undefined : firstError ?? "All channels failed",
  };
}
```

- [ ] **Step 2: Rewire the notification actions in `src/app/(app)/settings/actions.ts`**

Replace the imports block (lines ~1–18) so it pulls the new helpers, and drop the old `GeneralSchema`/`sendNtfy` usage:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  categories,
  paymentMethods,
  subscriptions,
  payments,
  settings,
} from "@/db/schema";
import { saveSettings, getSettings } from "@/lib/settings";
import { settingsFormSchema } from "@/lib/notify/payloads";
import {
  channelById,
  hasActiveChannel,
  detectTelegramChatId as detectTelegramChatIdLib,
} from "@/lib/notify";
import type { ChannelId } from "@/lib/notify/types";
import { runDailyReminders } from "@/lib/reminders";
import { refreshFxRates } from "@/lib/fx";
import { parseBackup } from "@/lib/backup";
```

Delete the old `const GeneralSchema = z.object({...})` block, then replace `saveGeneralSettings`, `sendTestNotification`, and `runRemindersNow` with:

```ts
export async function saveGeneralSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const raw = Object.fromEntries(
    [
      "base_currency", "notify_lead_days",
      "ntfy_enabled", "ntfy_server", "ntfy_topic",
      "telegram_enabled", "telegram_bot_token", "telegram_chat_id",
      "email_enabled", "email_smtp_host", "email_smtp_port", "email_smtp_secure",
      "email_smtp_user", "email_smtp_pass", "email_from", "email_to",
    ].map((k) => [k, formData.get(k) ?? ""]),
  );

  const parsed = settingsFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const v = parsed.data;

  saveSettings({
    base_currency: v.base_currency,
    notify_lead_days: String(v.notify_lead_days),
    ntfy_enabled: v.ntfy_enabled ? "1" : "",
    ntfy_server: v.ntfy_server || "https://ntfy.sh",
    ntfy_topic: v.ntfy_topic,
    telegram_enabled: v.telegram_enabled ? "1" : "",
    telegram_bot_token: v.telegram_bot_token,
    telegram_chat_id: v.telegram_chat_id,
    email_enabled: v.email_enabled ? "1" : "",
    email_smtp_host: v.email_smtp_host,
    email_smtp_port: v.email_smtp_port,
    email_smtp_secure: v.email_smtp_secure ? "1" : "",
    email_smtp_user: v.email_smtp_user,
    email_smtp_pass: v.email_smtp_pass,
    email_from: v.email_from,
    email_to: v.email_to,
  });

  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/subscriptions");
  return { ok: true };
}

/** Send a one-off test through a single channel. */
export async function sendTestNotification(channelId: ChannelId): Promise<ActionState> {
  const s = getSettings();
  const ch = channelById(channelId);
  if (!ch) return { error: "Unknown channel." };
  if (!ch.isConfigured(s)) return { error: `Configure ${ch.label} first.` };
  const err = await ch.send(s, {
    title: "Squirrel test",
    message: "🐿️ Notifications are working! You'll get renewal reminders here.",
    tags: ["white_check_mark"],
  });
  return err ? { error: err } : { ok: true };
}

export async function detectTelegramChatId(
  token: string,
): Promise<{ chatId?: string; error?: string }> {
  return detectTelegramChatIdLib(token.trim());
}

/** Run the renewal-reminder check right now (same logic as the daily job). */
export async function runRemindersNow(): Promise<ActionState & { sent?: number }> {
  const s = getSettings();
  if (!hasActiveChannel(s)) return { error: "Enable and configure a notification channel first." };
  const res = await runDailyReminders();
  if (res.error) return { error: res.error };
  return { ok: true, sent: res.sent };
}
```

(Leave the `z` import out — it is no longer used in this file. If any other action still uses `z`, keep it; otherwise remove the import to satisfy lint.)

- [ ] **Step 3: Verify typecheck + all unit tests**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all existing tests + Task 1 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/reminders.ts "src/app/(app)/settings/actions.ts"
git commit -m "feat(notify): fan reminders out to all channels; per-channel test + chat-id detect"
```

---

### Task 4: Settings UI — channels section

Replace the single ntfy block in the General card with three channel rows (toggle + config + per-channel Test), keeping base currency and lead-days.

**Files:**
- Modify: `src/components/settings-view.tsx`

**Interfaces:**
- Consumes: `sendTestNotification(channelId)`, `detectTelegramChatId(token)` (Task 3); `Switch` (`src/components/ui/switch.tsx`, exists).

- [ ] **Step 1: Update imports in `src/components/settings-view.tsx`**

Add to the action import block: `detectTelegramChatId`. Add component/util imports:

```ts
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
```

Ensure `sendTestNotification` stays imported (its call signature changes below). Add the `Radio`/no new icons needed — reuse `Send`.

- [ ] **Step 2: Add channel client state + handlers**

Inside the General card component (the one holding `formAction`, `pending`, `runTest`, `testing`/`startTest`, `currency`), add near the other `useState` hooks:

```ts
const [ntfyOn, setNtfyOn] = useState(settings.ntfy_enabled === "1");
const [tgOn, setTgOn] = useState(settings.telegram_enabled === "1");
const [emailOn, setEmailOn] = useState(settings.email_enabled === "1");
const [emailSecure, setEmailSecure] = useState(settings.email_smtp_secure === "1");
const [chatId, setChatId] = useState(settings.telegram_chat_id);
const tokenRef = useRef<HTMLInputElement>(null);
```

Replace the existing `runTest` function with a per-channel tester, and add the detect handler:

```ts
function testChannel(id: "ntfy" | "telegram" | "email") {
  startTest(async () => {
    const res = await sendTestNotification(id);
    if (res.error) toast.error(res.error);
    else toast.success("Test notification sent");
  });
}

function detectChatId() {
  startTest(async () => {
    const res = await detectTelegramChatId(tokenRef.current?.value ?? "");
    if (res.error) toast.error(res.error);
    else if (res.chatId) {
      setChatId(res.chatId);
      toast.success(`Detected chat id ${res.chatId}`);
    }
  });
}
```

(`useRef` is already imported at the top of the file; `useState`/`useTransition` too.)

- [ ] **Step 3: Replace the ntfy grid with the channels section**

Replace the block from `<div className="grid gap-5 sm:grid-cols-2">` containing `ntfy_server`/`ntfy_topic` (the second grid, ~lines 318–340) with:

```tsx
          <div className="space-y-4">
            <p className="text-sm font-medium">Notification channels</p>

            {/* ntfy */}
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>ntfy</Label>
                  <p className="text-xs text-muted-foreground">Push to the ntfy app.</p>
                </div>
                <Switch checked={ntfyOn} onCheckedChange={(v) => setNtfyOn(Boolean(v))} />
              </div>
              <input type="hidden" name="ntfy_enabled" value={ntfyOn ? "1" : ""} />
              <div className={cn("mt-4 grid gap-4 sm:grid-cols-2", !ntfyOn && "hidden")}>
                <div className="space-y-2">
                  <Label htmlFor="ntfy_server">Server</Label>
                  <Input id="ntfy_server" name="ntfy_server" defaultValue={settings.ntfy_server} placeholder="https://ntfy.sh" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ntfy_topic">Topic</Label>
                  <Input id="ntfy_topic" name="ntfy_topic" defaultValue={settings.ntfy_topic} placeholder="squirrel-alerts-x8f2" />
                  <p className="text-xs text-muted-foreground">Subscribe to this topic in the ntfy app to get pushes.</p>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => testChannel("ntfy")} disabled={testing}>
                <Send className="size-4" /> Test ntfy
              </Button>
            </div>

            {/* Telegram */}
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Telegram</Label>
                  <p className="text-xs text-muted-foreground">Create a bot with @BotFather, then paste its token.</p>
                </div>
                <Switch checked={tgOn} onCheckedChange={(v) => setTgOn(Boolean(v))} />
              </div>
              <input type="hidden" name="telegram_enabled" value={tgOn ? "1" : ""} />
              <div className={cn("mt-4 grid gap-4 sm:grid-cols-2", !tgOn && "hidden")}>
                <div className="space-y-2">
                  <Label htmlFor="telegram_bot_token">Bot token</Label>
                  <Input ref={tokenRef} id="telegram_bot_token" name="telegram_bot_token" type="password" defaultValue={settings.telegram_bot_token} placeholder="123456:ABC-DEF..." />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="telegram_chat_id">Chat id</Label>
                  <div className="flex gap-2">
                    <Input id="telegram_chat_id" name="telegram_chat_id" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="987654321" />
                    <Button type="button" variant="outline" onClick={detectChatId} disabled={testing}>Detect</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Message your bot once, then click Detect.</p>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => testChannel("telegram")} disabled={testing}>
                <Send className="size-4" /> Test Telegram
              </Button>
            </div>

            {/* Email */}
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Email</Label>
                  <p className="text-xs text-muted-foreground">Send reminders over SMTP.</p>
                </div>
                <Switch checked={emailOn} onCheckedChange={(v) => setEmailOn(Boolean(v))} />
              </div>
              <input type="hidden" name="email_enabled" value={emailOn ? "1" : ""} />
              <input type="hidden" name="email_smtp_secure" value={emailSecure ? "1" : ""} />
              <div className={cn("mt-4 grid gap-4 sm:grid-cols-2", !emailOn && "hidden")}>
                <div className="space-y-2">
                  <Label htmlFor="email_smtp_host">SMTP host</Label>
                  <Input id="email_smtp_host" name="email_smtp_host" defaultValue={settings.email_smtp_host} placeholder="smtp.gmail.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email_smtp_port">SMTP port</Label>
                  <Input id="email_smtp_port" name="email_smtp_port" type="number" defaultValue={settings.email_smtp_port} placeholder="587" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email_smtp_user">Username</Label>
                  <Input id="email_smtp_user" name="email_smtp_user" defaultValue={settings.email_smtp_user} placeholder="you@gmail.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email_smtp_pass">Password</Label>
                  <Input id="email_smtp_pass" name="email_smtp_pass" type="password" defaultValue={settings.email_smtp_pass} placeholder="app password" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email_from">From</Label>
                  <Input id="email_from" name="email_from" defaultValue={settings.email_from} placeholder="Squirrel <you@gmail.com>" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email_to">To</Label>
                  <Input id="email_to" name="email_to" defaultValue={settings.email_to} placeholder="you@gmail.com" />
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={emailSecure} onCheckedChange={(v) => setEmailSecure(Boolean(v))} />
                  <Label>Use TLS on connect (port 465)</Label>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => testChannel("email")} disabled={testing}>
                <Send className="size-4" /> Test email
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Tokens and passwords are stored in the app database and are included in JSON backups.
            </p>
          </div>
```

- [ ] **Step 4: Fix the footer buttons**

In the button row at the bottom of the form (currently "Save changes" / "Send test" / "Run reminders now"), remove the old standalone **Send test** button (testing now lives per-channel). Keep **Save changes** and **Run reminders now** unchanged.

- [ ] **Step 5: Verify build + lint**

Run: `npx tsc --noEmit && npm run build`
Expected: compiles; no unused-symbol lint errors (old `runTest` removed, `Send` still used per-channel).

- [ ] **Step 6: Manual E2E (dev server)**

Run `npm run dev`, open `/settings`:
1. Toggle Telegram on, leave token empty, **Save** → error toast "Telegram needs a bot token and chat id when on."
2. With a real ntfy topic set + enabled, **Test ntfy** → toast "Test notification sent"; ntfy phone receives.
3. Toggle Telegram off, **Save**, reopen settings → the token/chat id values are still present (inputs stay mounted; only the enabled flag cleared).
4. **Run reminders now** with two channels enabled → both receive (or an accurate error toast).

- [ ] **Step 7: Commit**

```bash
git add src/components/settings-view.tsx
git commit -m "feat(notify): channels UI — per-channel toggle, config, test, chat-id detect"
```

---

### Task 5: Bundle ntfy in Compose + docs + version bump

**Files:**
- Modify: `docker-compose.yml`
- Modify: `README.md`
- Modify: `package.json` (version)

- [ ] **Step 1: Add the ntfy service to `docker-compose.yml`**

After the `squirrel` service (before end of file), add a sibling service and a top-level `volumes:` block. Replace `YOUR-NAS-IP` guidance stays in README; here use an env-substitutable base URL:

```yaml
  # Optional self-hosted ntfy so the default channel needs no third party.
  # Point Squirrel's "ntfy server" setting at http://ntfy (internal), and
  # subscribe your phone to http://YOUR-NAS-IP:8481/<topic>.
  ntfy:
    image: binwiederhier/ntfy:latest
    container_name: squirrel-ntfy
    command: serve
    environment:
      NTFY_BASE_URL: "${NTFY_BASE_URL:-http://localhost:8481}"
    ports:
      - "8481:80"
    volumes:
      - ntfy-cache:/var/cache/ntfy
      - ntfy-data:/var/lib/ntfy
    restart: unless-stopped

volumes:
  ntfy-cache:
  ntfy-data:
```

- [ ] **Step 2: Update the README notifications section**

In `README.md`:
- Change the "Renewal reminders" feature bullet to mention multiple channels: `a daily push before a subscription renews — via **ntfy**, **Telegram**, or **email** (enable any combination).`
- Rename the **## Phone notifications (ntfy)** section to **## Notifications** and add three subsections:
  - **ntfy** — the existing steps, plus a "Self-hosted ntfy (optional)" note: add the `ntfy` service from the Compose stack, set Squirrel's *ntfy server* to `http://ntfy`, and subscribe the phone to `http://YOUR-NAS-IP:8481/<topic>` (internal vs external URL).
  - **Telegram** — 1) message @BotFather, `/newbot`, copy the token; 2) in Squirrel → Settings enable Telegram, paste the token; 3) send your new bot any message, click **Detect** to fill the chat id; 4) **Test Telegram**.
  - **Email** — enable Email, fill SMTP host/port/user/pass, From and To (e.g. Gmail SMTP `smtp.gmail.com:587` with an app password), **Test email**.
- Add one line under the section: *Channel tokens and passwords are stored in Squirrel's database and included in JSON backups — keep backups private.*

- [ ] **Step 3: Bump the version**

In `package.json`, change `"version": "1.6.0"` to `"version": "1.7.0"`.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: succeeds; footer shows 1.7.0.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml README.md package.json
git commit -m "feat(notify): bundle self-hosted ntfy in compose; docs + v1.7.0"
```

---

## Self-Review Notes

- **Spec coverage:** abstraction (T1/T2), ntfy refactor (T2), Telegram + detect (T2/T3/T4), Email + nodemailer (T2/T4), settings model no-migration (T1), fan-out reminders (T3), per-channel test (T3/T4), UI toggles (T4), compose ntfy + docs + version (T5), tests (T1) — all mapped.
- **Behaviour preservation:** `ntfy_enabled` default `"1"` + `isConfigured` gate on topic ⇒ existing ntfy-only setups unchanged.
- **Type consistency:** `sendTestNotification(channelId)` new signature has exactly one caller (settings UI, T4). `notifyAll(s, msg)` / `ChannelResult` / `hasActiveChannel` names consistent across T2/T3. `settingsFormSchema` defined T1, consumed T3.
- **Purity:** `types.ts`/`payloads.ts` use `import type` for `AppSettings` only — safe under vitest.
- **Config persistence:** channel config inputs stay mounted (collapsed via `hidden`, which still submits) so toggling a channel off does not wipe its stored credentials.
```
