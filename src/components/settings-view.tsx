"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  LoaderCircle,
  Plus,
  Trash2,
  Send,
  Check,
  Monitor,
  Moon,
  Sun,
  BellRing,
  Download,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { Category, PaymentMethod } from "@/db/schema";
import type { AppSettings } from "@/lib/settings";
import { COMMON_CURRENCIES } from "@/lib/currency";
import { APP_VERSION } from "@/lib/version";
import {
  saveGeneralSettings,
  sendTestNotification,
  detectTelegramChatId,
  runRemindersNow,
  addCategory,
  updateCategory,
  deleteCategory,
  addPaymentMethod,
  deletePaymentMethod,
  importBackup,
  type ActionState,
} from "@/app/(app)/settings/actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const initial: ActionState = {};

export function SettingsView({
  settings,
  categories,
  paymentMethods,
}: {
  settings: AppSettings;
  categories: Category[];
  paymentMethods: PaymentMethod[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure currency, reminders and how Squirrel looks.
        </p>
      </div>

      <GeneralCard settings={settings} />
      <AppearanceCard />
      <CategoriesCard categories={categories} />
      <PaymentMethodsCard paymentMethods={paymentMethods} />
      <DataCard />

      <p className="pt-2 text-center text-xs text-muted-foreground">
        🐿️ Squirrel v{APP_VERSION}
      </p>
    </div>
  );
}

function DataCard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<{
    text: string;
    subs: number;
    payments: number;
  } | null>(null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = JSON.parse(text);
      setConfirm({
        text,
        subs: parsed?.data?.subscriptions?.length ?? 0,
        payments: parsed?.data?.payments?.length ?? 0,
      });
    } catch {
      toast.error("That file isn't valid JSON.");
    }
  }

  function runRestore() {
    if (!confirm) return;
    const text = confirm.text;
    start(async () => {
      const res = await importBackup(text);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success(`Restored ${res.replaced ?? 0} subscription(s) from backup.`);
        setConfirm(null);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data</CardTitle>
        <CardDescription>
          Export to CSV for spreadsheets and tax, or take a full JSON backup you
          can restore onto any Squirrel instance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            render={<a href="/api/export/payments" download />}
            nativeButton={false}
            variant="outline"
            className="justify-start gap-2"
          >
            <Download className="size-4" />
            Payment history (.csv)
          </Button>
          <Button
            render={<a href="/api/export/subscriptions" download />}
            nativeButton={false}
            variant="outline"
            className="justify-start gap-2"
          >
            <Download className="size-4" />
            Subscriptions (.csv)
          </Button>
        </div>

        <div className="border-t pt-5">
          <p className="mb-3 text-sm text-muted-foreground">
            Full backup — everything in one JSON file. Restoring{" "}
            <span className="font-medium text-foreground">replaces all current data</span>.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              render={<a href="/api/export/backup" download />}
              nativeButton={false}
              variant="outline"
              className="justify-start gap-2"
            >
              <Download className="size-4" />
              Download backup (.json)
            </Button>
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-4" />
              Restore from backup…
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={onPickFile}
            />
          </div>
        </div>
      </CardContent>

      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace all data?</DialogTitle>
            <DialogDescription>
              This permanently deletes everything currently in Squirrel and loads
              the backup ({confirm?.subs ?? 0} subscription
              {confirm?.subs === 1 ? "" : "s"}, {confirm?.payments ?? 0} charge
              {confirm?.payments === 1 ? "" : "s"}). It can&apos;t be undone —
              download a backup first if you&apos;re unsure.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirm(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={runRestore} disabled={pending}>
              {pending ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Restoring…
                </>
              ) : (
                "Replace everything"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function GeneralCard({ settings }: { settings: AppSettings }) {
  const [state, formAction, pending] = useActionState(saveGeneralSettings, initial);
  const [currency, setCurrency] = useState(settings.base_currency);
  const [testing, startTest] = useTransition();
  const [ntfyOn, setNtfyOn] = useState(settings.ntfy_enabled === "1");
  const [tgOn, setTgOn] = useState(settings.telegram_enabled === "1");
  const [emailOn, setEmailOn] = useState(settings.email_enabled === "1");
  const [emailSecure, setEmailSecure] = useState(settings.email_smtp_secure === "1");
  const [chatId, setChatId] = useState(settings.telegram_chat_id);
  const tokenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.ok) toast.success("Settings saved");
    else if (state.error) toast.error(state.error);
  }, [state]);

  function testChannel(id: "ntfy" | "telegram" | "email") {
    startTest(async () => {
      const res = await sendTestNotification(id);
      if (res.error) toast.error(res.error);
      else toast.success("Test notification sent");
    });
  }

  function detectChatId() {
    startTest(async () => {
      const res = await detectTelegramChatId(tokenRef.current?.value ?? "");
      if (res.error) toast.error(res.error);
      else if (res.chatId) {
        setChatId(res.chatId);
        toast.success(`Detected chat id ${res.chatId}`);
      }
    });
  }

  function runReminders() {
    startTest(async () => {
      const res = await runRemindersNow();
      if (res.error) toast.error(res.error);
      else if (res.sent && res.sent > 0)
        toast.success(`Reminder sent for ${res.sent} subscription${res.sent > 1 ? "s" : ""}`);
      else
        toast.info("No reminders due — nothing renews today or in your lead-days window");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>Base currency and renewal reminders.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-5">
          <input type="hidden" name="base_currency" value={currency} />
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Base currency</Label>
              <Select value={currency} onValueChange={(v) => setCurrency(v ?? "GBP")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Totals are converted to this currency.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notify_lead_days">Remind me (days before)</Label>
              <Input
                id="notify_lead_days"
                name="notify_lead_days"
                type="number"
                min="0"
                max="60"
                defaultValue={settings.notify_lead_days}
              />
              <p className="text-xs text-muted-foreground">
                How many days ahead to send a reminder.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm font-medium">Notification channels</p>

            {/* ntfy */}
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>ntfy</Label>
                  <p className="text-xs text-muted-foreground">Push to the ntfy app.</p>
                </div>
                <Switch checked={ntfyOn} onCheckedChange={(v) => setNtfyOn(Boolean(v))} />
              </div>
              <input type="hidden" name="ntfy_enabled" value={ntfyOn ? "1" : ""} />
              <div className={cn("mt-4 grid gap-4 sm:grid-cols-2", !ntfyOn && "hidden")}>
                <div className="space-y-2">
                  <Label htmlFor="ntfy_server">Server</Label>
                  <Input id="ntfy_server" name="ntfy_server" defaultValue={settings.ntfy_server} placeholder="https://ntfy.sh" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ntfy_topic">Topic</Label>
                  <Input id="ntfy_topic" name="ntfy_topic" defaultValue={settings.ntfy_topic} placeholder="squirrel-alerts-x8f2" />
                  <p className="text-xs text-muted-foreground">Subscribe to this topic in the ntfy app to get pushes.</p>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => testChannel("ntfy")} disabled={testing}>
                <Send className="size-4" /> Test ntfy
              </Button>
            </div>

            {/* Telegram */}
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Telegram</Label>
                  <p className="text-xs text-muted-foreground">Create a bot with @BotFather, then paste its token.</p>
                </div>
                <Switch checked={tgOn} onCheckedChange={(v) => setTgOn(Boolean(v))} />
              </div>
              <input type="hidden" name="telegram_enabled" value={tgOn ? "1" : ""} />
              <div className={cn("mt-4 grid gap-4 sm:grid-cols-2", !tgOn && "hidden")}>
                <div className="space-y-2">
                  <Label htmlFor="telegram_bot_token">Bot token</Label>
                  <Input ref={tokenRef} id="telegram_bot_token" name="telegram_bot_token" type="password" defaultValue={settings.telegram_bot_token} placeholder="123456:ABC-DEF..." />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="telegram_chat_id">Chat id</Label>
                  <div className="flex gap-2">
                    <Input id="telegram_chat_id" name="telegram_chat_id" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="987654321" />
                    <Button type="button" variant="outline" onClick={detectChatId} disabled={testing}>Detect</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Message your bot once, then click Detect.</p>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => testChannel("telegram")} disabled={testing}>
                <Send className="size-4" /> Test Telegram
              </Button>
            </div>

            {/* Email */}
            <div className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Email</Label>
                  <p className="text-xs text-muted-foreground">Send reminders over SMTP.</p>
                </div>
                <Switch checked={emailOn} onCheckedChange={(v) => setEmailOn(Boolean(v))} />
              </div>
              <input type="hidden" name="email_enabled" value={emailOn ? "1" : ""} />
              <input type="hidden" name="email_smtp_secure" value={emailSecure ? "1" : ""} />
              <div className={cn("mt-4 grid gap-4 sm:grid-cols-2", !emailOn && "hidden")}>
                <div className="space-y-2">
                  <Label htmlFor="email_smtp_host">SMTP host</Label>
                  <Input id="email_smtp_host" name="email_smtp_host" defaultValue={settings.email_smtp_host} placeholder="smtp.gmail.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email_smtp_port">SMTP port</Label>
                  <Input id="email_smtp_port" name="email_smtp_port" type="number" defaultValue={settings.email_smtp_port} placeholder="587" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email_smtp_user">Username</Label>
                  <Input id="email_smtp_user" name="email_smtp_user" defaultValue={settings.email_smtp_user} placeholder="you@gmail.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email_smtp_pass">Password</Label>
                  <Input id="email_smtp_pass" name="email_smtp_pass" type="password" defaultValue={settings.email_smtp_pass} placeholder="app password" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email_from">From</Label>
                  <Input id="email_from" name="email_from" defaultValue={settings.email_from} placeholder="Squirrel <you@gmail.com>" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email_to">To</Label>
                  <Input id="email_to" name="email_to" defaultValue={settings.email_to} placeholder="you@gmail.com" />
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={emailSecure} onCheckedChange={(v) => setEmailSecure(Boolean(v))} />
                  <Label>Use TLS on connect (port 465)</Label>
                </div>
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => testChannel("email")} disabled={testing}>
                <Send className="size-4" /> Test email
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Tokens and passwords are stored in the app database and are included in JSON backups.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Save changes
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={runReminders}
              disabled={testing}
              className="gap-1.5"
            >
              <BellRing className="size-4" />
              Run reminders now
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Choose your theme.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid max-w-md grid-cols-3 gap-2">
          {options.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-xl border p-4 text-sm transition-colors",
                theme === value
                  ? "border-primary bg-primary/5 text-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="size-5" />
              {label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CategoriesCard({ categories }: { categories: Category[] }) {
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");

  function add() {
    if (!newName.trim()) return;
    start(async () => {
      const res = await addCategory(newName, newColor);
      if (res.error) toast.error(res.error);
      else {
        toast.success("Category added");
        setNewName("");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Categories</CardTitle>
        <CardDescription>Group subscriptions and colour your charts.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {categories.map((c) => (
          <CategoryRow key={c.id} category={c} />
        ))}

        <div className="flex items-center gap-2 pt-2">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent"
            aria-label="New category colour"
          />
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New category…"
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Button onClick={add} disabled={pending} className="shrink-0 gap-1">
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  const [pending, start] = useTransition();
  const dirty = name !== category.name || color !== category.color;

  function save() {
    start(async () => {
      const res = await updateCategory(category.id, name, color);
      if (res.error) toast.error(res.error);
      else toast.success("Category updated");
    });
  }
  function remove() {
    start(async () => {
      await deleteCategory(category.id);
      toast.success("Category deleted");
    });
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent"
        aria-label={`${category.name} colour`}
      />
      <Input value={name} onChange={(e) => setName(e.target.value)} />
      {dirty ? (
        <Button size="icon" onClick={save} disabled={pending} aria-label="Save">
          <Check className="size-4" />
        </Button>
      ) : null}
      <Button
        size="icon"
        variant="ghost"
        onClick={remove}
        disabled={pending}
        aria-label="Delete"
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function PaymentMethodsCard({ paymentMethods }: { paymentMethods: PaymentMethod[] }) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");

  function add() {
    if (!name.trim()) return;
    start(async () => {
      const res = await addPaymentMethod(name);
      if (res.error) toast.error(res.error);
      else {
        toast.success("Payment method added");
        setName("");
      }
    });
  }
  function remove(id: number) {
    start(async () => {
      await deletePaymentMethod(id);
      toast.success("Payment method deleted");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment methods</CardTitle>
        <CardDescription>How you pay for each subscription.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {paymentMethods.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <div className="flex-1 rounded-lg border px-3 py-2 text-sm">{p.name}</div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => remove(p.id)}
              disabled={pending}
              aria-label="Delete"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New payment method…"
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Button onClick={add} disabled={pending} className="shrink-0 gap-1">
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
