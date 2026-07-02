import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "squirrel_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * The password required to log in. If unset/empty, authentication is DISABLED
 * (open access) — convenient for local dev or a fully trusted LAN. Set
 * APP_PASSWORD in the Docker env to require a login.
 */
export function getAppPassword(): string | null {
  const pw = process.env.APP_PASSWORD;
  return pw && pw.length > 0 ? pw : null;
}

export function isAuthEnabled(): boolean {
  return getAppPassword() !== null;
}

/**
 * Secret used to sign session cookies. Prefer an explicit SESSION_SECRET; fall
 * back to deriving one from APP_PASSWORD so the app works with minimal config.
 */
function getSecret(): Uint8Array {
  const raw =
    process.env.SESSION_SECRET ||
    process.env.APP_PASSWORD ||
    "squirrel-insecure-dev-secret";
  return new TextEncoder().encode(raw);
}

/** Constant-time-ish password comparison. */
export function verifyPassword(input: string): boolean {
  const expected = getAppPassword();
  if (expected === null) return true; // auth disabled
  if (input.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < input.length; i++) {
    mismatch |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ role: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, getSecret());
    return true;
  } catch {
    return false;
  }
}

/**
 * Session cookie options. `secure` MUST reflect the actual request scheme, not
 * NODE_ENV: this app is typically accessed over plain HTTP on a LAN (e.g.
 * http://nas-ip:8480), and browsers silently drop `Secure` cookies over HTTP
 * (except on localhost) — which logs you straight back out. Only mark the
 * cookie Secure when the request really came over HTTPS (e.g. behind a
 * TLS-terminating reverse proxy that sets x-forwarded-proto).
 */
export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}
