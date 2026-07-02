import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isAuthEnabled, verifySessionToken } from "@/lib/auth";

const PUBLIC_PATHS = ["/login"];

export async function proxy(req: NextRequest) {
  // Auth disabled (no APP_PASSWORD) — let everything through.
  if (!isAuthEnabled()) return NextResponse.next();

  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const authed = await verifySessionToken(token);

  // Already logged in and visiting /login → send to dashboard.
  if (authed && isPublic) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (!authed && !isPublic) {
    const url = new URL("/login", req.url);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except static assets, the favicon, and the PWA files.
  // The web manifest, service worker and icons must stay public even when a
  // password is set, or the browser can't install/parse the PWA (it would get
  // redirected to the login HTML instead of the JSON/JS).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|.*\\.png$).*)",
  ],
};
