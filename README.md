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
- **Cancellations** — mark a subscription cancelled and it stays usable (and
  counted) until the end of the paid period, then automatically drops to
  inactive on that date. No more forgetting what you've cancelled but can still
  use.
- **Light & dark** themes, responsive, keyboard-friendly.
- **Optional password** login, or open access on a trusted LAN.

## Install on a NAS / homelab (recommended)

Squirrel ships as a prebuilt multi-arch image on the GitHub Container Registry,
so **any** Docker host runs the same thing — TrueNAS SCALE, Unraid, Synology, a
Raspberry Pi, or plain `docker compose`. There's nothing to build and no source
to clone; you just paste a Compose stack.

**Paste this stack** (TrueNAS "Custom App → Install via YAML", Dockge, Portainer
"Stacks", or a `compose.yaml` file), edit the two secrets, and deploy:

```yaml
services:
  squirrel:
    image: ghcr.io/code-by-gunnar/squirrel:latest
    container_name: squirrel
    restart: unless-stopped
    ports:
      - "8480:3000"
    environment:
      APP_PASSWORD: "change-me"
      SESSION_SECRET: "replace-with-a-long-random-string"
      BASE_CURRENCY: "GBP"
      TZ: "Europe/London"
    volumes:
      - squirrel-data:/app/data
volumes:
  squirrel-data:
```

Then open `http://YOUR-NAS-IP:8480`.

Before deploying, edit two values:

- `APP_PASSWORD` — your login password. Leave it as `""` for open access on a
  trusted LAN.
- `SESSION_SECRET` — any long random string. Generate one with
  `openssl rand -base64 32` (keep the surrounding quotes when you paste it in).

The `8480:3000` line is `host:container` — change `8480` if that port is taken.
The database lives in the `squirrel-data` named volume; to keep it on a specific
dataset instead, replace that volume line with a bind mount, e.g.
`- /mnt/tank/apps/squirrel:/app/data`.

> **Tip:** paste the YAML exactly as shown. Don't add inline `#` comments with
> punctuation like em dashes or `<angle brackets>` — some stack editors reject
> non-ASCII characters with a "yaml: construct errors" message.

**Updating:** pull the new image and recreate — `docker compose pull && docker
compose up -d` (Dockge/Portainer have an "update" button that does this). Your
data in the volume is preserved.

> **First-time note:** the GHCR package is private until you make it public.
> On GitHub, go to your profile → **Packages → squirrel → Package settings →
> Change visibility → Public**. (Or, on the NAS, `docker login ghcr.io` with a
> personal access token that has `read:packages`.)

## Run from source (development)

```bash
git clone https://github.com/code-by-gunnar/squirrel && cd squirrel
cp .env.example .env
# edit .env: set APP_PASSWORD and a random SESSION_SECRET
docker compose up -d --build
```

This uses the repo's `docker-compose.yml` (which builds the image locally and
bind-mounts `./data`). To update: `git pull && docker compose up -d --build`.

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
