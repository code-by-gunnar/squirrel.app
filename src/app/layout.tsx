import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { PWARegister } from "@/components/pwa-register";

// Fonts are self-hosted (see src/fonts) so production builds never depend on
// reaching Google Fonts — important for rebuilding on the NAS.

// Body / UI: warm humanist grotesque, highly legible at small sizes.
const sans = localFont({
  src: "../fonts/HankenGrotesk-Variable.woff2",
  variable: "--font-hanken",
  weight: "400 700",
  display: "swap",
});

// Display / headings: editorial grotesque with a bit of character.
const display = localFont({
  src: "../fonts/SchibstedGrotesk-Variable.woff2",
  variable: "--font-schibsted",
  weight: "500 700",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Squirrel — Subscription Tracker",
  description: "Track and manage your recurring subscriptions in one place.",
  applicationName: "Squirrel",
  appleWebApp: {
    capable: true,
    title: "Squirrel",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  // Extend under the notch / home indicator so the bottom nav can use safe-area.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#12100f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster richColors position="top-center" />
          <PWARegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
