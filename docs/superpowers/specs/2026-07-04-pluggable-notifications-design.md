# Pluggable Notification Channels

**Date:** 2026-07-04
**Status:** Approved (design)
**Version target:** 1.6.0 → 1.7.0

## Context

Squirrel sends renewal reminders through a single hard-wired transport: ntfy.
`reminders.ts` calls `sendNtfy()` directly, and the settings model only knows
`ntfy_server` / `ntfy_topic`. That forces every user onto ntfy — which means
trusting ntfy.sh (or self-hosting it) *and* installing the ntfy phone app.

The goal is to let people keep ntfy as the default but **switch to, or add,
channels they already use**. Two extra channels are in scope — **Telegram**
(free, fully self-serve, an app most people already have) and **Email** (no app
needed on the receiving end). SMS and WhatsApp are explicitly out of scope (paid
accounts, phone numbers, Business-API approval — wrong friction for a personal
self-hosted tool).

Reminders fan out to **every enabled + configured channel** (not a single
"active" one), each independently toggleable and testable.

Separately, a self-hosted **ntfy server is bundled into the Docker Compose
stack** so the default channel can run fully self-hosted without trusting
ntfy.sh.

## Non-goals

- SMS / WhatsApp channels.
- Per-subscription channel routing (all reminders use the same channel set; the
  existing per-subscription `notify` boolean still decides *whether* a sub is
  included, unchanged).
- Encrypting channel secrets at rest (they live in the SQLite DB, consistent
  with how the ntfy topic is stored today; called out to the user in UI/README).

## Architecture

### Overview

A **channel registry**. Each channel is an object implementing a common
`NotificationChannel` interface. A dispatcher (`notifyAll`) loops the registry
and sends to every channel that is enabled and configured. Adding a channel is
adding one entry to the registry array — the reminder/dispatch core never
changes.

Pure formatting/validation is split from server-only IO, matching the codebase's
existing convention (billing/currency/csv are pure and unit-tested; modules with
`import "server-only"` throw under vitest).

### `src/lib/notify/` (folder replaces the current `src/lib/notify.ts`)

`@/lib/notify` import specifiers keep resolving because the folder's `index.ts`
becomes the module entry.

**`types.ts`** (pure)

```ts
export type ChannelId = "ntfy" | "telegram" | "email";

// Superset shape every channel maps down from.
export type NotificationMessage = {
  title: string;
  message: string;
  tags?: string[];              // ntfy only
  priority?: 1 | 2 | 3 | 4 | 5; // ntfy only
  clickUrl?: string;            // ntfy click action
};

export type ChannelResult = { id: ChannelId; label: string; error: string | null };

export interface NotificationChannel {
  id: ChannelId;
  label: string;
  isEnabled(s: AppSettings): boolean;     // the `<id>_enabled` flag
  isConfigured(s: AppSettings): boolean;  // required fields present
  send(s: AppSettings, msg: NotificationMessage): Promise<string | null>; // error | null
}
```

> **Purity trap:** `AppSettings` lives in `settings.ts`, which is
> `import "server-only"`. `types.ts` and `payloads.ts` are pure (vitest runs
> them), so they must reference it with a **type-only** import
> (`import type { AppSettings } from "@/lib/settings"`) — type-only imports are
> erased at compile time and never pull the server-only runtime guard. No value
> import from `settings.ts` may appear in the pure modules.

**`payloads.ts`** (pure, unit-tested) — the per-channel logic that has no IO:

- `buildNtfyPayload(topic, msg)` → the ntfy JSON body (extracted from today's
  `sendNtfy`).
- `buildTelegramPayload(chatId, msg)` → `{ chat_id, text, parse_mode: "Markdown",
  disable_web_page_preview: true }`; title rendered as a bold first line.
- `buildEmail(from, to, msg)` → `{ from, to, subject, text }` (subject = title,
  text = message; renewal lines preserved).
- `isNtfyConfigured` / `isTelegramConfigured` / `isEmailConfigured` predicates.
- Zod config schemas per channel, used by both the save action and tests.

**`index.ts`** (server-only) — IO + wiring:

- `sendNtfy(server, topic, msg)` — kept (existing signature, now delegates to
  `buildNtfyPayload`) so `sendTestNotification`'s existing call site and any
  other importers keep working.
- `sendTelegram(s, msg)` — `fetch` to `https://api.telegram.org/bot<token>/sendMessage`.
- `sendEmail(s, msg)` — `nodemailer` transport from the SMTP settings.
- `CHANNELS: NotificationChannel[]` — `[ntfy, telegram, email]`, each wiring its
  metadata + predicate + sender.
- `notifyAll(msg): Promise<ChannelResult[]>` — loop `CHANNELS`, skip any not
  (enabled && configured), `await ch.send(...)`, collect `{ id, label, error }`.
  A throw inside a channel is caught and recorded as that channel's error; one
  channel failing never blocks the others.
- `channelById(id)` — for per-channel test.
- `detectTelegramChatId(token): Promise<{ chatId?: string; error?: string }>` —
  calls the bot's `getUpdates` and returns the most recent chat id (friction
  reducer; see Telegram section).

### Channels

**ntfy** — behaviour-preserving refactor of the current sender into a channel.

**Telegram** — user creates a bot via @BotFather (free), pastes the **bot token**
and their **chat id**. Send is a single `fetch` POST (no dependency). A non-2xx
response returns Telegram's `description` field as the error string. Getting the
chat id is the one friction point, mitigated by `detectTelegramChatId`: the user
messages their bot once, clicks **Detect chat id**, and we read it from
`getUpdates`.

**Email** — SMTP via `nodemailer` (`host`, `port`, `secure` bool, `user`, `pass`,
`from`, `to`). Chosen over a transactional API (Resend/SendGrid) to keep with the
"own your data / no third-party account" ethos — homelab users can point at Gmail
SMTP with an app password, a relay, or their own server. New deps: `nodemailer`,
`@types/nodemailer`. Server-only; never bundled to the client.

## Settings model

Key/value `settings` table — **no schema migration**, just new keys and a wider
`AppSettings` type. A channel receives reminders **iff `<id>_enabled` is truthy
AND `isConfigured` is true**, so existing ntfy users are unaffected (still gated
on having a topic).

| Key | Default | Notes |
|-----|---------|-------|
| `ntfy_enabled` | `"1"` | on by default (preserves current behaviour) |
| `ntfy_server` | `https://ntfy.sh` | existing |
| `ntfy_topic` | `""` | existing; gates ntfy |
| `telegram_enabled` | `""` | off |
| `telegram_bot_token` | `""` | secret |
| `telegram_chat_id` | `""` | |
| `email_enabled` | `""` | off |
| `email_smtp_host` | `""` | |
| `email_smtp_port` | `""` | coerced to number on use (e.g. 587) |
| `email_smtp_secure` | `""` | `"1"` = TLS on connect (465); else STARTTLS |
| `email_smtp_user` | `""` | |
| `email_smtp_pass` | `""` | secret |
| `email_from` | `""` | |
| `email_to` | `""` | |

`DEFAULT_SETTINGS` in `seed.ts` gains these (blank except `ntfy_enabled: "1"`),
written on first run via the existing `INSERT OR IGNORE`. `getSettings()` widens
`AppSettings` and reads them with `""` fallbacks.

**Secrets** (`telegram_bot_token`, `email_smtp_pass`) are stored in plaintext in
the DB — the same trust model as today's ntfy topic — and are therefore included
in JSON backups. Surfaced with a one-line note in the Notifications card and the
README.

## Reminders & server actions

`src/lib/reminders.ts`
- `runDailyReminders()` builds the `NotificationMessage` once (unchanged title /
  bullet-line body), then calls `notifyAll(msg)`.
- Success = at least one channel returned no error. Return shape becomes
  `{ sent: number; results: ChannelResult[]; error?: string }` where `sent` is
  the due-sub count when ≥1 channel delivered, else 0. The "nothing configured"
  short-circuit generalises from "No ntfy topic configured" to "No notification
  channel enabled".
- The due-subscription filter (`active && !free && notify && daysUntil in {lead,
  0}`) is unchanged.

`src/app/(app)/settings/actions.ts`
- `saveGeneralSettings` — `GeneralSchema` extended with all new fields (each
  optional / `.or(z.literal(""))`), plus a `.superRefine` that requires a
  channel's fields when its `_enabled` flag is set (mirrors the existing
  null-field/superRefine pattern). Persists via `saveSettings`.
- `sendTestNotification(channelId: ChannelId)` — resolves the channel via
  `channelById`, guards `isConfigured`, sends the test message, returns
  `{ ok }` or `{ error }`. (Signature gains a required `channelId`; the sole
  caller — the settings UI — is updated.)
- `detectTelegramChatId(token)` — thin wrapper over the lib helper for the UI
  button.
- `runRemindersNow()` — unchanged externally; now fans out via the updated
  `runDailyReminders`.

`src/lib/scheduler.ts` — no change (still calls `runDailyReminders` on the 9am
cron); the fan-out happens inside.

## UI — `src/components/settings-view.tsx`

The Notifications card keeps **base currency** and **remind-me lead days**, and
replaces the single ntfy block with a **Channels** section: three rows
(ntfy / Telegram / Email). Each row is a `Switch` (enable) that reveals its
config inputs and a per-row **Test** button (`sendTestNotification(id)` →
toast). Telegram's row includes a **Detect chat id** button. One **Save** button
persists the whole form.

- Adds a `Switch` UI component (Base UI) if not already present in
  `src/components/ui/`.
- All inputs are uncontrolled with `defaultValue` from settings, matching the
  existing form. Secret inputs use `type="password"`.
- A muted one-liner notes that tokens/passwords are stored in the app database
  and included in backups.

## Docker — bundled ntfy

`docker-compose.yml` (dev/source stack) and the README paste-stack gain an
opt-in `ntfy` service:

```yaml
  ntfy:
    image: binwiederhier/ntfy:latest
    container_name: squirrel-ntfy
    command: serve
    environment:
      NTFY_BASE_URL: "http://YOUR-NAS-IP:8481"
    ports:
      - "8481:80"
    volumes:
      - ntfy-cache:/var/cache/ntfy
      - ntfy-data:/var/lib/ntfy
    restart: unless-stopped
```

The app publishes server-side to `http://ntfy` (compose service name) via the
`ntfy_server` setting; the phone subscribes to `http://YOUR-NAS-IP:8481/<topic>`.
The app's built-in default stays `https://ntfy.sh` so existing deployments are
untouched — the bundled server is opt-in by using the documented stack and
setting `ntfy server` to `http://ntfy`. README gets a short "self-hosted ntfy"
subsection explaining the internal-vs-external URL distinction.

## Testing

- **Unit (`src/lib/notify/payloads.test.ts`, pure):**
  - `buildTelegramPayload` — bold title line, chat id wiring, Markdown mode.
  - `buildEmail` — subject/text mapping.
  - `buildNtfyPayload` — parity with the pre-refactor JSON body (topic, title,
    message, optional tags/priority/click).
  - Config predicates + zod schemas — enabled-but-missing-field is rejected;
    fully-configured passes; disabled channel needs no fields.
- **Build:** `npm run build` typechecks the new action signatures, settings type,
  and nodemailer import (server-only).
- **E2E (dev server + Playwright):**
  1. Toggle Telegram on, save with an empty token → superRefine error surfaces.
  2. Configure ntfy + Telegram both enabled → **Run reminders now** → both
     receive; disabling one drops it from the fan-out.
  3. Per-channel **Test** buttons hit only their channel; a bad SMTP host yields
     that channel's error toast without affecting the others.
  4. Export a backup → confirm channel settings (incl. secrets) round-trip.
- **Regression:** an existing ntfy-only setup (topic set, others blank) behaves
  exactly as before.

## Rollout

1. Core abstraction — `notify/` folder, refactor ntfy in behind the registry,
   `notifyAll`, reminders call it. Tests green, no user-visible change.
2. Telegram channel + `detectTelegramChatId`.
3. Email channel + `nodemailer` dep.
4. Settings model + UI (Switch, per-channel config + Test, superRefine, save).
5. ntfy compose service + README/docs.
6. Version bump 1.7.0, README channel docs, changelog.

## Files

**Create:** `src/lib/notify/types.ts`, `src/lib/notify/payloads.ts`,
`src/lib/notify/index.ts`, `src/lib/notify/payloads.test.ts`,
`src/components/ui/switch.tsx` (if absent).

**Delete/replace:** `src/lib/notify.ts` → `src/lib/notify/index.ts`.

**Modify:** `src/lib/reminders.ts`, `src/app/(app)/settings/actions.ts`,
`src/lib/settings.ts`, `src/db/seed.ts`, `src/components/settings-view.tsx`,
`docker-compose.yml`, `README.md`, `package.json` (deps + version).
