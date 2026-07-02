import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// Read the version from package.json at build time so we can show it in the UI.
const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as {
  version: string;
};

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for a small Docker image.
  output: "standalone",
  // better-sqlite3 is a native module and must not be bundled by Turbopack/webpack.
  serverExternalPackages: ["better-sqlite3"],
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
};

export default nextConfig;
