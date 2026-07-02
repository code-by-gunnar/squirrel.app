import "server-only";

export type NtfyMessage = {
  title: string;
  message: string;
  tags?: string[];
  priority?: 1 | 2 | 3 | 4 | 5;
  clickUrl?: string;
};

/**
 * Publish a notification to an ntfy topic. Returns an error string on failure,
 * or null on success. Server + topic come from settings.
 *
 * ntfy accepts a plain-text body plus metadata via headers. Non-ASCII titles
 * must be avoided in headers, so we keep titles simple.
 */
export async function sendNtfy(
  server: string,
  topic: string,
  msg: NtfyMessage,
): Promise<string | null> {
  if (!topic) return "No ntfy topic configured.";

  const base = (server || "https://ntfy.sh").replace(/\/+$/, "");
  const url = `${base}/${encodeURIComponent(topic)}`;

  const headers: Record<string, string> = {
    Title: msg.title,
  };
  if (msg.tags?.length) headers.Tags = msg.tags.join(",");
  if (msg.priority) headers.Priority = String(msg.priority);
  if (msg.clickUrl) headers.Click = msg.clickUrl;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: msg.message,
    });
    if (!res.ok) {
      return `ntfy responded ${res.status} ${res.statusText}`;
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Failed to reach ntfy server";
  }
}
