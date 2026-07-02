import "server-only";
import { createHash } from "node:crypto";

const TIMEOUT_MS = 6000;
const MAX_BYTES = 200_000; // ~200 KB cap for the stored data URI

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * Work out the best domain to look a logo up by. Prefer an explicit URL, then a
 * name that already looks like a domain (e.g. "fly.io"), then a naive guess
 * from the name (e.g. "Netflix" -> "netflix.com").
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
  const trimmed = name.trim().toLowerCase();
  if (DOMAIN_RE.test(trimmed)) return trimmed.replace(/^www\./, "");
  const slug = trimmed.replace(/[^a-z0-9]/g, "");
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

export type LogoCandidate = { dataUri: string; domain: string; source: string };

/** Candidate domains to try, most-confident first. */
function candidateDomains(query: string): string[] {
  const q = query.trim().toLowerCase();
  const out: string[] = [];
  const push = (d?: string | null) => {
    if (d && !out.includes(d)) out.push(d);
  };

  if (/^https?:\/\//i.test(q)) {
    try {
      push(new URL(q).hostname.replace(/^www\./, ""));
    } catch {
      /* ignore */
    }
  }
  if (DOMAIN_RE.test(q)) push(q.replace(/^www\./, ""));

  const slug = q.replace(/[^a-z0-9]/g, "");
  if (slug) {
    push(`${slug}.com`);
    push(`${slug}.io`);
    push(`${slug}.app`);
  }
  return out.slice(0, 5);
}

function sourcesFor(domain: string): { source: string; url: string }[] {
  return [
    { source: "icon.horse", url: `https://icon.horse/icon/${domain}` },
    { source: "DuckDuckGo", url: `https://icons.duckduckgo.com/ip3/${domain}.ico` },
    { source: "unavatar", url: `https://unavatar.io/${domain}` },
    { source: "Google", url: `https://www.google.com/s2/favicons?domain=${domain}&sz=128` },
  ];
}

/**
 * Find several logo candidates for a query (a brand name, domain, or URL) so the
 * user can pick the right one. Queries multiple domains × sources in parallel,
 * fetches each as a data URI, and de-duplicates identical images.
 */
export async function searchLogoCandidates(query: string): Promise<LogoCandidate[]> {
  const domains = candidateDomains(query);
  if (domains.length === 0) return [];

  const tasks: Promise<LogoCandidate | null>[] = [];
  for (const domain of domains) {
    for (const { source, url } of sourcesFor(domain)) {
      tasks.push(
        fetchAsDataUri(url).then((dataUri) =>
          dataUri ? { dataUri, domain, source } : null,
        ),
      );
    }
  }

  const found = (await Promise.all(tasks)).filter(Boolean) as LogoCandidate[];

  const seen = new Set<string>();
  const unique: LogoCandidate[] = [];
  for (const c of found) {
    const hash = createHash("sha1").update(c.dataUri).digest("hex");
    if (seen.has(hash)) continue;
    seen.add(hash);
    unique.push(c);
  }
  return unique.slice(0, 12);
}
