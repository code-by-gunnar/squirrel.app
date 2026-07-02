# Squirrel — Subscription Tracker Design

_Date: 2026-07-02_

A personal, self-hosted subscription tracker. Single user, runs as one Docker
container on a home NAS. Inspired by [Wallos](https://github.com/ellite/Wallos)
but rebuilt with a modern stack and a deliberately polished UI. Not exposed to
the public internet.

## Goals

- Add / edit / delete subscriptions across many services, with categories and
  payment methods.
- See what I spend per month / per year, and where.
- See when things renew (list + calendar).
- Track subscriptions in different currencies, converted to a base currency.
- Get a phone push when something is about to renew.
- Look and feel clean, smooth and modern — the main thing Wallos lacks.

## Non-goals (YAGNI for v1)

- Multi-user / household members / accounts.
- Multi-channel notifications (only ntfy in v1).
- OIDC / OAuth, email verification, password reset flows.
- The 10-cronjob architecture Wallos uses.

## Decisions

| Area | Choice | Why |
|------|--------|-----|
| Framework | Next.js 16 (App Router, React 19, Turbopack) | Modern, great for polished UI, matches existing experience |
| Language | TypeScript | Type safety end to end |
| UI | Tailwind + shadcn/ui | Fast path to a clean, consistent design system |
| DB | SQLite via Drizzle ORM | Zero-ops, single file on a volume, perfect for one user |
| Data access | Server Components read DB; Server Actions for mutations | No separate API layer needed |
| Auth | Single password via `APP_PASSWORD` env, signed HTTP-only session cookie | Simplest thing that's safe enough behind a NAS |
| Currency | Base currency (default GBP) + per-sub currency | Track anything, total in one currency |
| FX rates | Frankfurter API (free, no key, ECB daily), cached in DB | No API key, refreshed daily |
| Notifications | ntfy (topic URL, optional self-hosted server) | Free phone push, homelab-friendly, pluggable |
| Scheduling | Single in-process daily job (node-cron) | Refresh FX + fire due-soon pushes; no cron sprawl |
| Packaging | Multi-stage Dockerfile (Next.js standalone) + docker-compose | One image, SQLite on a mounted volume |

## Data model (SQLite / Drizzle)

```
subscriptions
  id              INTEGER PK
  name            TEXT NOT NULL
  logo_url        TEXT
  url             TEXT              -- link to the service / cancel page
  price           REAL NOT NULL
  currency_code   TEXT NOT NULL     -- e.g. 'GBP', 'USD'
  billing_cycle   TEXT NOT NULL     -- 'day' | 'week' | 'month' | 'year'
  billing_interval INTEGER NOT NULL DEFAULT 1  -- "every N cycles"
  start_date      DATE NOT NULL     -- immutable anchor; renewals computed from this
  trial_end_date  DATE              -- optional free-trial end
  category_id     INTEGER FK -> categories
  payment_method_id INTEGER FK -> payment_methods
  notes           TEXT
  active          INTEGER NOT NULL DEFAULT 1
  notify          INTEGER NOT NULL DEFAULT 1
  created_at      TEXT NOT NULL

categories        id, name, color
payment_methods   id, name
settings          key TEXT PK, value TEXT   -- base_currency, ntfy_*, notify_lead_days, theme...
fx_rates          code TEXT PK, rate_to_base REAL, fetched_at TEXT
```

### Why no stored `next_payment`

Wallos stores `next_payment` and mutates it nightly via cron, which can drift.
Squirrel stores an immutable `start_date` + `billing_cycle` + `billing_interval`
and **computes** the next renewal on read. Always correct, nothing to update,
and past/future periods are all derivable.

## Core logic (pure, unit-tested functions)

- `computeNextRenewal(startDate, cycle, interval, from = today)` → next date ≥ `from`,
  plus "renews in N days".
- `monthlyEquivalent(price, cycle, interval)` → normalizes any cycle to a monthly
  figure so totals across cycles are comparable.
- Dashboard totals = Σ `monthlyEquivalent(price) × fxRate(currency_code)` for active
  subs, grouped by category.

## Pages

- `/` **Dashboard** — monthly & yearly spend (base currency), spend-by-category
  chart, next 5 renewals, active-sub count, empty state.
- `/subscriptions` — card/list grid; sort (name / price / next renewal); filter
  (category / active). Add/edit in a slide-over sheet: logo, name, url, price +
  currency, cycle + interval, start date, trial end, category, payment method,
  notes, notify toggle. Delete with confirm.
- `/calendar` — month grid with renewal markers; click a day to see what renews.
- `/settings` — base currency, ntfy config (topic, server), notify lead days,
  categories & payment methods CRUD, theme (dark/light).
- `/login` — single password → signed HTTP-only session cookie. Middleware
  guards all routes except `/login`.

## Scheduled work (one job)

A single daily in-process task (node-cron), started with the server:

1. Refresh FX rates from Frankfurter into `fx_rates`.
2. Find active subs renewing within `notify_lead_days` (respecting `notify`) and
   POST to the configured ntfy topic.

No external cron container, no per-task scripts.

## Design direction

Driven via the design skill: clean modern dashboard, dark + light themes, soft
depth, rounded cards, smooth micro-interactions. Sensible loading / empty /
error states throughout. Reviewed before finalizing.

## Packaging

- Multi-stage Dockerfile using Next.js `output: 'standalone'`.
- `docker-compose.yml` mounts a volume for the SQLite file and passes config via
  env (`APP_PASSWORD`, `SESSION_SECRET`, `BASE_CURRENCY`, `NTFY_*`, `TZ`).
- Migrations run on container start.

## Milestones

1. Scaffold: Next.js 16 + Tailwind + shadcn/ui + Drizzle + SQLite; schema + migrations; seed.
2. Auth: password login, session cookie, route middleware.
3. Core logic + tests: renewal & monthly-equivalent functions.
4. Subscriptions CRUD (Server Actions) + list/grid UI + add/edit sheet.
5. Settings: base currency, categories, payment methods, ntfy, lead days, theme.
6. Dashboard + stats + charts.
7. Calendar view.
8. FX refresh + daily notify job (node-cron) + ntfy integration.
9. Design pass (design skill) across all pages.
10. Dockerfile + docker-compose + README.
