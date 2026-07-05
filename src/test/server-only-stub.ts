// Stub for the "server-only" package under Vitest.
//
// Next.js resolves the bare specifier "server-only" to its own bundled
// no-op module at build time (webpack/turbopack alias) — it's never an
// installed npm dependency. Vitest uses plain Node resolution, so any file
// under test that has `import "server-only"` at the top (e.g. src/db/index.ts,
// src/lib/subscriptions.ts) fails with "Cannot find package 'server-only'"
// unless we alias it here too. This file intentionally does nothing.
export {};
