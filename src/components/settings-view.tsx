"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useTheme } from "next-themes";
import { LoaderCircle, Plus, Trash2, Send, Check, Monitor, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import type { Category, PaymentMethod } from "@/db/schema";
import type { AppSettings } from "@/lib/settings";
import { COMMON_CURRENCIES } from "@/lib/currency";
import {
  saveGeneralSettings,
  sendTestNotification,
  addCategory,
  updateCategory,
  deleteCategory,
  addPaymentMethod,
  deletePaymentMethod,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
    </div>
  );
}

function GeneralCard({ settings }: { settings: AppSettings }) {
  const [state, formAction, pending] = useActionState(saveGeneralSettings, initial);
  const [currency, setCurrency] = useState(settings.base_currency);
  const [testing, startTest] = useTransition();

  useEffect(() => {
    if (state.ok) toast.success("Settings saved");
    else if (state.error) toast.error(state.error);
  }, [state]);

  function runTest() {
    startTest(async () => {
      const res = await sendTestNotification();
      if (res.error) toast.error(res.error);
      else toast.success("Test notification sent");
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

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ntfy_server">ntfy server</Label>
              <Input
                id="ntfy_server"
                name="ntfy_server"
                defaultValue={settings.ntfy_server}
                placeholder="https://ntfy.sh"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ntfy_topic">ntfy topic</Label>
              <Input
                id="ntfy_topic"
                name="ntfy_topic"
                defaultValue={settings.ntfy_topic}
                placeholder="squirrel-alerts-x8f2"
              />
              <p className="text-xs text-muted-foreground">
                Subscribe to this topic in the ntfy app to get pushes.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Save changes
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={runTest}
              disabled={testing}
            >
              {testing ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Send test
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
