import type { AppSettings } from "@/lib/settings";

export type ChannelId = "ntfy" | "telegram" | "email";

/** Superset message shape; each channel maps down from it. */
export type NotificationMessage = {
  title: string;
  message: string;
  tags?: string[]; // ntfy only
  priority?: 1 | 2 | 3 | 4 | 5; // ntfy only
  clickUrl?: string; // ntfy click action
};

export type ChannelResult = { id: ChannelId; label: string; error: string | null };

export interface NotificationChannel {
  id: ChannelId;
  label: string;
  isEnabled(s: AppSettings): boolean;
  isConfigured(s: AppSettings): boolean;
  /** Returns an error string on failure, or null on success. */
  send(s: AppSettings, msg: NotificationMessage): Promise<string | null>;
}

export const CHANNEL_LABELS: Record<ChannelId, string> = {
  ntfy: "ntfy",
  telegram: "Telegram",
  email: "Email",
};
