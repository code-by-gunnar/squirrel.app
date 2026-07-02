import "server-only";

const TIMEOUT_MS = 6000;
const MAX_BYTES = 200_000; // ~200 KB cap for the stored data URI

/**
 * Work out the best domain to look a logo up by. Prefer an explicit URL; fall
 * back to a naive guess from the name (e.g. "Netflix" -> "netflix.com").
 */
export function deriveDomain(name: string, url?: string | null): string | null {
  if (url && url.trim()) {
    try {
      const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      const host = new URL(withProto).hostname.replace(/^www\./, "");
      if (host.includes(".")) return host;
    } catch {
      /* fall through to the name guess */
    }
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return slug ? `${slug}.com` : null;
}

async function fetchAsDataUri(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength < 70 || bytes.byteLength > MAX_BYTES) return null; // reject blanks/oversize
    return `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a brand logo for a subscription and return it as a base64 data URI so
 * it can be cached in the database (no third-party request when a card renders,
 * works offline, keeps your subscription list private). Returns null if nothing
 * usable is found — callers fall back to a coloured initial.
 *
 * Sources are keyless: DuckDuckGo (higher-res) then Google's favicon service.
 */
export async function fetchLogoDataUri(
  name: string,
  url?: string | null,
): Promise<string | null> {
  const domain = deriveDomain(name, url);
  if (!domain) return null;

  const sources = [
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
  ];

  for (const source of sources) {
    const dataUri = await fetchAsDataUri(source);
    if (dataUri) return dataUri;
  }
  return null;
}
