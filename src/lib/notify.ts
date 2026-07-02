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
 * We use ntfy's JSON publishing API (title/message in the JSON body, posted to
 * the server root) rather than HTTP headers. Headers must be ASCII, so putting
 * the title in a header would throw or garble for subscription names with
 * accents or emoji (e.g. "Café"). JSON handles UTF-8 cleanly.
 */
export async function sendNtfy(
  server: string,
  topic: string,
  msg: NtfyMessage,
): Promise<string | null> {
  if (!topic) return "No ntfy topic configured.";

  const base = (server || "https://ntfy.sh").replace(/\/+$/, "");

  const payload: Record<string, unknown> = {
    topic,
    title: msg.title,
    message: msg.message,
  };
  if (msg.tags?.length) payload.tags = msg.tags;
  if (msg.priority) payload.priority = msg.priority;
  if (msg.clickUrl) payload.click = msg.clickUrl;

  try {
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return `ntfy responded ${res.status} ${res.statusText}`;
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Failed to reach ntfy server";
  }
}
