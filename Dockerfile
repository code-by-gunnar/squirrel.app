# syntax=docker/dockerfile:1

# --- Dependencies (with build tools for better-sqlite3) ---
FROM node:24-bookworm-slim AS deps
WORKDIR /app
# python3/make/g++ are only needed if a prebuilt better-sqlite3 binary is
# unavailable for this platform; harmless otherwise.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# --- Build ---
FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Runtime ---
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/app/data/squirrel.db

RUN groupadd --system --gid 1001 squirrel \
    && useradd --system --uid 1001 --gid squirrel squirrel

# Next.js standalone server bundle + static assets + migration SQL.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle

# Persistent SQLite lives on a mounted volume.
RUN mkdir -p /app/data && chown -R squirrel:squirrel /app
VOLUME ["/app/data"]

USER squirrel
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
