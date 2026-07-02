# 🐿️ Squirrel

A personal, self-hosted subscription tracker. Add and manage recurring
subscriptions across any number of services, see what you spend per month and
year, know when things renew, and get a push to your phone before they do.

Built to run as a single Docker container on a home NAS. Single user, no cloud.

## Features

- **Track subscriptions** with price, currency, billing cycle (e.g. every 3
  months), category, payment method, start date, free-trial end, notes and a
  link to the service.
- **Dashboard** — monthly & yearly spend, spend by category, upcoming renewals.
- **Calendar** — a month view of exactly when each subscription renews.
- **Multi-currency** — track subs in any currency; totals convert to your base
  currency using free daily ECB rates (Frankfurter, no API key).
- **Renewal reminders** — a daily push to your phone via
  [ntfy](https://ntfy.sh) before a subscription renews.
- **Light & dark** themes, responsive, keyboard-friendly.
- **Optional password** login, or open access on a trusted LAN.

## Quick start (Docker Compose)

```bash
git clone <this repo> squirrel && cd squirrel
cp .env.example .env
# edit .env: set APP_PASSWORD and a random SESSION_SECRET
docker compose up -d --build
```

Then open `http://<your-nas-ip>:8480`.

The SQLite database is stored in `./data` and persists across upgrades. To
update: `git pull && docker compose up -d --build`.

## Configuration

All via environment variables (see `.env.example`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `APP_PASSWORD` | _(empty)_ | Login password. Empty = no auth (open on LAN). |
| `SESSION_SECRET` | _(change me)_ | Signs the session cookie. Use a long random string. |
| `BASE_CURRENCY` | `GBP` | Base currency for totals (also changeable in Settings). |
| `TZ` | `Europe/London` | Timezone for the daily FX + reminder jobs. |

Base currency, reminder lead time, categories, payment methods and ntfy config
are all editable in **Settings** once running.

## Phone notifications (ntfy)

1. Install the [ntfy app](https://ntfy.sh/app) on your phone.
2. Subscribe to a topic of your choosing, e.g. `squirrel-alerts-<random>`.
3. In Squirrel → **Settings**, set the same topic (and your server if you
   self-host ntfy). Hit **Send test** to confirm.

Squirrel sends a reminder `N` days before a renewal (configurable) and again on
the day. It pairs nicely with a self-hosted ntfy server on the same NAS.

## Local development

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # billing/currency unit tests
npm run build      # production build
```

The database is created at `./data/squirrel.db` on first run; migrations and
default categories/payment methods are applied automatically.

## Tech

Next.js 16 (App Router, React 19) · TypeScript · Tailwind + shadcn/ui (Base UI)
· SQLite via Drizzle ORM · node-cron for the daily jobs. Renewal dates are
computed on read from an immutable start date, so they never drift.

See [docs/plans/2026-07-02-squirrel-design.md](docs/plans/2026-07-02-squirrel-design.md)
for the full design.

## License

Personal project. Do what you like with it.
