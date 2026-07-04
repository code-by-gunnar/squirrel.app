import { z } from "zod";

// Row shapes mirror src/db/schema.ts. zod strips unknown keys by default, so a
// backup from a newer app version with extra fields still restores cleanly.
const SettingRow = z.object({ key: z.string(), value: z.string().nullable() });
const CategoryRow = z.object({
  id: z.number().int(),
  name: z.string(),
  color: z.string(),
});
const PaymentMethodRow = z.object({ id: z.number().int(), name: z.string() });
const SubscriptionRow = z.object({
  id: z.number().int(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  url: z.string().nullable(),
  price: z.number(),
  currencyCode: z.string(),
  billingCycle: z.string(),
  billingInterval: z.number().int(),
  startDate: z.string(),
  trialEndDate: z.string().nullable(),
  categoryId: z.number().int().nullable(),
  paymentMethodId: z.number().int().nullable(),
  notes: z.string().nullable(),
  active: z.boolean(),
  notify: z.boolean(),
  free: z.boolean(),
  cancelled: z.boolean(),
  endsOn: z.string().nullable(),
  createdAt: z.string(),
});
const PaymentRow = z.object({
  id: z.number().int(),
  subscriptionId: z.number().int(),
  paidOn: z.string(),
  amount: z.number(),
  currencyCode: z.string(),
  amountBase: z.number(),
  baseCurrency: z.string(),
  fxRate: z.number(),
  createdAt: z.string(),
});

export const BackupSchema = z.object({
  app: z.literal("squirrel").optional(),
  schema: z.number(),
  appVersion: z.string().optional(),
  exportedAt: z.string().optional(),
  data: z.object({
    settings: z.array(SettingRow),
    categories: z.array(CategoryRow),
    paymentMethods: z.array(PaymentMethodRow),
    subscriptions: z.array(SubscriptionRow),
    payments: z.array(PaymentRow),
  }),
});

export type Backup = z.infer<typeof BackupSchema>;
export type BackupData = Backup["data"];

/** Current backup file format version. Bump if the shape changes incompatibly. */
export const BACKUP_SCHEMA_VERSION = 1;

/**
 * Parse and validate a backup file's text. Pure (no DB) so it can run in tests
 * and client-side. Returns a typed backup or a human-readable error.
 */
export function parseBackup(
  text: string,
): { ok: true; data: Backup } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }

  const parsed = BackupSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (!issue) return { ok: false, error: "Invalid backup file." };
    const where = issue.path.length ? ` (${issue.path.join(".")})` : "";
    return { ok: false, error: `Invalid backup file${where}: ${issue.message}` };
  }
  return { ok: true, data: parsed.data };
}
