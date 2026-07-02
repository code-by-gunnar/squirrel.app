import { LoginForm } from "./login-form";

// Force per-request rendering. Without this, /login is statically prerendered
// at build time; behind a caching reverse proxy / CDN that build-time snapshot
// gets served for the login POST, discarding the server action's result
// (set-cookie + redirect) so login silently does nothing. Every other route is
// force-dynamic too — this keeps /login consistent.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginForm />;
}
