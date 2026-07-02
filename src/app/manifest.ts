import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest and auto-linked by Next.js.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Squirrel — Subscription Tracker",
    short_name: "Squirrel",
    description: "Track and manage your recurring subscriptions in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#1a6b47",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
