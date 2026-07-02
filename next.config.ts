import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for a small Docker image.
  output: "standalone",
  // better-sqlite3 is a native module and must not be bundled by Turbopack/webpack.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
