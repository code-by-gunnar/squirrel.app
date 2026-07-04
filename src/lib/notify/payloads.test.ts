import { describe, it, expect } from "vitest";
import {
  buildNtfyPayload,
  buildTelegramPayload,
  buildEmail,
  isNtfyConfigured,
  isTelegramConfigured,
  isEmailConfigured,
  isChannelEnabled,
  settingsFormSchema,
} from "./payloads";
import type { AppSettings } from "@/lib/settings";

const base: AppSettings = {
  base_currency: "GBP", notify_lead_days: "3", theme: "system",
  ntfy_enabled: "1", ntfy_server: "https://ntfy.sh", ntfy_topic: "",
  telegram_enabled: "", telegram_bot_token: "", telegram_chat_id: "",
  email_enabled: "", email_smtp_host: "", email_smtp_port: "", email_smtp_secure: "",
  email_smtp_user: "", email_smtp_pass: "", email_from: "", email_to: "",
};

describe("buildNtfyPayload", () => {
  it("maps message fields and includes optional tags/priority/click", () => {
    const p = buildNtfyPayload("my-topic", {
      title: "T", message: "M", tags: ["moneybag"], priority: 4, clickUrl: "http://x",
    });
    expect(p).toEqual({ topic: "my-topic", title: "T", message: "M", tags: ["moneybag"], priority: 4, click: "http://x" });
  });
  it("omits optional fields when absent", () => {
    expect(buildNtfyPayload("t", { title: "T", message: "M" })).toEqual({ topic: "t", title: "T", message: "M" });
  });
});

describe("buildTelegramPayload", () => {
  it("bolds the title as the first Markdown line", () => {
    expect(buildTelegramPayload("123", { title: "T", message: "M" })).toEqual({
      chat_id: "123", text: "*T*\nM", parse_mode: "Markdown", disable_web_page_preview: true,
    });
  });
});

describe("buildEmail", () => {
  it("maps title to subject and message to text", () => {
    expect(buildEmail("a@x", "b@y", { title: "T", message: "M" })).toEqual({
      from: "a@x", to: "b@y", subject: "T", text: "M",
    });
  });
});

describe("config predicates", () => {
  it("ntfy needs a topic", () => {
    expect(isNtfyConfigured(base)).toBe(false);
    expect(isNtfyConfigured({ ...base, ntfy_topic: "x" })).toBe(true);
  });
  it("telegram needs token and chat id", () => {
    expect(isTelegramConfigured({ ...base, telegram_bot_token: "t" })).toBe(false);
    expect(isTelegramConfigured({ ...base, telegram_bot_token: "t", telegram_chat_id: "c" })).toBe(true);
  });
  it("email needs host, from and to", () => {
    expect(isEmailConfigured({ ...base, email_smtp_host: "h", email_from: "f" })).toBe(false);
    expect(isEmailConfigured({ ...base, email_smtp_host: "h", email_from: "f", email_to: "t" })).toBe(true);
  });
  it("isChannelEnabled reads the flag", () => {
    expect(isChannelEnabled(base, "ntfy")).toBe(true);
    expect(isChannelEnabled(base, "telegram")).toBe(false);
  });
});

describe("settingsFormSchema", () => {
  const raw = {
    base_currency: "gbp", notify_lead_days: "3",
    ntfy_enabled: "1", ntfy_server: "", ntfy_topic: "my-topic",
    telegram_enabled: "", telegram_bot_token: "", telegram_chat_id: "",
    email_enabled: "", email_smtp_host: "", email_smtp_port: "", email_smtp_secure: "",
    email_smtp_user: "", email_smtp_pass: "", email_from: "", email_to: "",
  };
  it("accepts a valid form and upper-cases currency", () => {
    const r = settingsFormSchema.safeParse(raw);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.base_currency).toBe("GBP");
  });
  it("rejects ntfy enabled without a topic", () => {
    const r = settingsFormSchema.safeParse({ ...raw, ntfy_topic: "" });
    expect(r.success).toBe(false);
  });
  it("rejects telegram enabled without token/chat id", () => {
    const r = settingsFormSchema.safeParse({ ...raw, telegram_enabled: "1" });
    expect(r.success).toBe(false);
  });
  it("rejects email enabled without host/from/to", () => {
    const r = settingsFormSchema.safeParse({ ...raw, email_enabled: "1", email_smtp_host: "h" });
    expect(r.success).toBe(false);
  });
});
