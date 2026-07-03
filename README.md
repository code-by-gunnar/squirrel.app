<div align="center">

<img src="public/icon-512.png" alt="Squirrel logo" width="92" height="92" />

# Squirrel

**A personal, self-hosted subscription tracker.**

See what you spend each month, catch renewals before they hit, and know what
you're still paying for, all from one small container on your own NAS.

[![Self-hosted with Docker](https://img.shields.io/badge/self--hosted-Docker-2496ED?logo=docker&logoColor=white)](#install-on-a-nas--homelab-recommended)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](#tech)
[![SQLite + Drizzle](https://img.shields.io/badge/SQLite-Drizzle-003B57?logo=sqlite&logoColor=white)](#tech)
[![Installable PWA](https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white)](#access-over-https-for-pwa-install)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

<br/>

<img src="docs/screenshot-dashboard.png" alt="Squirrel dashboard showing monthly spend, spend by category and upcoming renewals" width="840" />

</div>

Built to run as a single Docker container on a home NAS. Single user, no cloud,
no account, nothing leaves home. Renewal dates are computed on read from an
immutable start date, so nothing to sync and nothing drifts.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshot-subscriptions.png" alt="Subscriptions grid with brand logos, prices and status" /><br/><sub><b>Subscriptions</b> — every service with its logo, price and next renewal</sub></td>
    <td width="50%"><img src="docs/screenshot-calendar.png" alt="Calendar view of upcoming renewals" /><br/><sub><b>Calendar</b> — see the month at a glance</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshot-dark.png" alt="Dashboard in dark mode" /><br/><sub><b>Dark mode</b> — out of the box</sub></td>
    <td width="50%" align="center"><img src="docs/screenshot-mobile.png" alt="Squirrel installed as an app on a phone" width="230" /><br/><sub><b>Installable PWA</b> — on your phone, as an app</sub></td>
  </tr>
</table>

## Features

- **Track subscriptions** with price, currency, billing cycle (e.g. every 3
  months), category, payment method, start date, free-trial end and notes,
  each with an auto-fetched brand logo (or pick one from a few candidates).
- **Dashboard** — monthly & yearly spend, spend by category, upcoming renewals.
- **Calendar** — a month view of exactly when each subscription renews.
- **Search, filter & sort** — filter by category or status (active / cancelled /
  free / inactive); sort by next renewal, name, or price (high–low).
- **Multi-currency** — track subs in any currency; totals convert to your base
  currency using free daily ECB rates (Frankfurter, no API key).
- **Renewal reminders** — a daily push to your phone via
  [ntfy](https://ntfy.sh) before a subscription renews.
- **Cancellations** — mark a subscription cancelled and it stays usable until
  the end of the paid period, then automatically drops to inactive on that date.
  It leaves your spend totals right away (it's already paid and won't renew), so
  your monthly figure stays accurate. No more forgetting what you've cancelled
  but can still use.
- **Free-tier tracking** — flag a service you're on the free plan for. It's kept
  for awareness but left out of spend totals, renewals and reminders.
- **Install as an app (PWA)** — add Squirrel to your phone's home screen for a
  native-style experience with a bottom nav bar and slide-up forms. (Installing
  standalone needs HTTPS — see [Access over HTTPS](#access-over-https-for-pwa-install).)
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

## Access over HTTPS (for PWA install)

Squirrel works fine over plain `http://YOUR-NAS-IP:8480` in a browser. But to
**install it as an app** on your phone — a home-screen icon that opens
full-screen with no address bar — it must be served over **HTTPS**. Browsers
only treat `https://` and `localhost` as a "secure context" and won't register
the service worker otherwise; over plain HTTP a phone just adds a bookmark that
opens in a browser tab.

Put any reverse proxy with a valid TLS certificate in front (Nginx Proxy
Manager, Caddy, Traefik, a Cloudflare Tunnel, or Tailscale). Two headers are
**required**, or login will bounce you back to the sign-in page as soon as you
navigate:

```nginx
proxy_set_header Host              $host;   # match the browser's origin
proxy_set_header X-Forwarded-Proto $scheme; # tell Squirrel the request is HTTPS
```

Use a real hostname with a trusted certificate, not `https://<ip>` — a cert
warning still counts as an insecure context and blocks the install. Then, on the
phone, use the browser's **Install app** option (not "Add to Home screen").

## Run from source (development)

```bash
git clone https://github.com/code-by-gunnar/squirrel.app && cd squirrel.app
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

Released under the [MIT License](LICENSE). Do what you like with it.
