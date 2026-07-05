import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Next.js aliases "server-only" to its own bundled no-op at build time;
      // it's not an installed dependency. Stub it so files that import it
      // (src/db/index.ts, src/lib/subscriptions.ts) can be unit-tested.
      "server-only": path.resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
});
