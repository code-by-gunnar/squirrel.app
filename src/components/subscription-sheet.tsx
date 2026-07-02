"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { LoaderCircle, ImageIcon, X, Search, Check } from "lucide-react";
import { toast } from "sonner";
import type { Subscription, Category, PaymentMethod } from "@/db/schema";
import {
  saveSubscription,
  searchLogos,
  type SaveState,
} from "@/app/(app)/subscriptions/actions";
import type { LogoCandidate } from "@/lib/logo";
import { cn } from "@/lib/utils";
import { BILLING_CYCLES } from "@/lib/billing";
import { COMMON_CURRENCIES } from "@/lib/currency";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
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

const CYCLE_LABELS: Record<string, string> = {
  day: "Day(s)",
  week: "Week(s)",
  month: "Month(s)",
  year: "Year(s)",
};

const initialState: SaveState = {};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  paymentMethods: PaymentMethod[];
  baseCurrency: string;
  subscription?: Subscription | null;
};

export function SubscriptionSheet({
  open,
  onOpenChange,
  categories,
  paymentMethods,
  baseCurrency,
  subscription,
}: Props) {
  const [state, formAction, pending] = useActionState(saveSubscription, initialState);
  const isEdit = !!subscription;

  // Controlled selects (native selects don't play well inside Radix, so we
  // mirror the value into a hidden input the server action reads).
  const [currency, setCurrency] = useState(subscription?.currencyCode ?? baseCurrency);
  const [cycle, setCycle] = useState(subscription?.billingCycle ?? "month");
  const [categoryId, setCategoryId] = useState(
    subscription?.categoryId ? String(subscription.categoryId) : "none",
  );
  const [paymentMethodId, setPaymentMethodId] = useState(
    subscription?.paymentMethodId ? String(subscription.paymentMethodId) : "none",
  );
  const [name, setName] = useState(subscription?.name ?? "");
  const [url, setUrl] = useState(subscription?.url ?? "");
  const [logoUrl, setLogoUrl] = useState<string | null>(subscription?.logoUrl ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [logoQuery, setLogoQuery] = useState("");
  const [candidates, setCandidates] = useState<LogoCandidate[]>([]);
  const [searching, startSearch] = useTransition();

  // Reset local state every time the sheet opens (or the target changes).
  // Keyed on `open` too, otherwise opening "Add" twice in a row keeps the
  // previous entry's state (e.g. its fetched logo leaks onto the next one).
  useEffect(() => {
    if (!open) return;
    setCurrency(subscription?.currencyCode ?? baseCurrency);
    setCycle(subscription?.billingCycle ?? "month");
    setCategoryId(subscription?.categoryId ? String(subscription.categoryId) : "none");
    setPaymentMethodId(
      subscription?.paymentMethodId ? String(subscription.paymentMethodId) : "none",
    );
    setName(subscription?.name ?? "");
    setUrl(subscription?.url ?? "");
    setLogoUrl(subscription?.logoUrl ?? null);
    setPickerOpen(false);
    setCandidates([]);
    setLogoQuery("");
  }, [open, subscription, baseCurrency]);

  function runLogoSearch(query: string) {
    if (!query.trim()) {
      toast.error("Type a name, domain, or website to search");
      return;
    }
    startSearch(async () => {
      const res = await searchLogos(query);
      if (res.error) {
        setCandidates([]);
        toast.error(res.error);
      } else {
        setCandidates(res.candidates ?? []);
      }
    });
  }

  function openLogoPicker() {
    const q = url.trim() || name.trim();
    setLogoQuery(q);
    setPickerOpen(true);
    setCandidates([]);
    if (q) runLogoSearch(q);
  }

  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? "Subscription updated" : "Subscription added");
      onOpenChange(false);
    } else if (state.error) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const today = new Date().toISOString().slice(0, 10);

  // Value -> label maps so the closed Select shows the name, not the raw id.
  const categoryItems: Record<string, string> = {
    none: "None",
    ...Object.fromEntries(categories.map((c) => [String(c.id), c.name])),
  };
  const paymentItems: Record<string, string> = {
    none: "None",
    ...Object.fromEntries(paymentMethods.map((p) => [String(p.id), p.name])),
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit subscription" : "Add subscription"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Update the details of this subscription."
              : "Track a new recurring payment."}
          </SheetDescription>
        </SheetHeader>

        <form action={formAction} className="flex flex-1 flex-col gap-4 px-4 pb-4">
          {isEdit ? <input type="hidden" name="id" value={subscription!.id} /> : null}
          <input type="hidden" name="currencyCode" value={currency} />
          <input type="hidden" name="billingCycle" value={cycle} />
          <input type="hidden" name="categoryId" value={categoryId} />
          <input type="hidden" name="paymentMethodId" value={paymentMethodId} />

          <div className="flex items-end gap-3">
            <div
              className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-muted/40"
              aria-hidden
            >
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="size-full object-contain p-1.5" />
              ) : (
                <span className="text-xl font-semibold text-muted-foreground">
                  {name.trim().charAt(0).toUpperCase() || "?"}
                </span>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Netflix"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => (pickerOpen ? setPickerOpen(false) : openLogoPicker())}
              className="gap-1.5"
            >
              <ImageIcon className="size-4" />
              {logoUrl ? "Change logo" : "Find logo"}
            </Button>
            {logoUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setLogoUrl(null)}
                className="gap-1.5 text-muted-foreground"
              >
                <X className="size-4" />
                Remove
              </Button>
            ) : null}
            <span className="text-xs text-muted-foreground">or auto-fetched on save</span>
          </div>

          {pickerOpen ? (
            <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={logoQuery}
                    onChange={(e) => setLogoQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        runLogoSearch(logoQuery);
                      }
                    }}
                    placeholder="Brand, domain, or website (e.g. fly.io)"
                    className="h-8 pl-8"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => runLogoSearch(logoQuery)}
                  disabled={searching}
                >
                  {searching ? <LoaderCircle className="size-4 animate-spin" /> : "Search"}
                </Button>
              </div>

              {searching ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" />
                  Searching…
                </div>
              ) : candidates.length > 0 ? (
                <>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                    {candidates.map((c, i) => {
                      const selected = logoUrl === c.dataUri;
                      return (
                        <button
                          key={i}
                          type="button"
                          title={`${c.domain} · ${c.source}`}
                          onClick={() => {
                            setLogoUrl(c.dataUri);
                            setPickerOpen(false);
                          }}
                          className={cn(
                            "relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-background p-1.5 transition-colors hover:border-primary",
                            selected && "border-primary ring-2 ring-primary/30",
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={c.dataUri} alt={c.domain} className="size-full object-contain" />
                          {selected ? (
                            <span className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <Check className="size-3" />
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {candidates.length} found — tap one to use it.
                  </p>
                </>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No logos yet. Try the exact domain, e.g. <code>fly.io</code>.
                </p>
              )}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="price">Price</Label>
              <Input
                id="price"
                name="price"
                type="number"
                step="0.01"
                min="0"
                required
                defaultValue={subscription?.price ?? ""}
                placeholder="9.99"
              />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={(v) => setCurrency(v ?? "")}>
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
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="billingInterval">Bills every</Label>
              <Input
                id="billingInterval"
                name="billingInterval"
                type="number"
                min="1"
                defaultValue={subscription?.billingInterval ?? 1}
              />
            </div>
            <div className="space-y-2">
              <Label>Cycle</Label>
              <Select
                value={cycle}
                onValueChange={(v) => setCycle(v ?? "month")}
                items={CYCLE_LABELS}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_CYCLES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CYCLE_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="startDate">Start / first payment date</Label>
            <Input
              id="startDate"
              name="startDate"
              type="date"
              required
              defaultValue={subscription?.startDate ?? today}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={categoryId}
                onValueChange={(v) => setCategoryId(v ?? "none")}
                items={categoryItems}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Payment method</Label>
              <Select
                value={paymentMethodId}
                onValueChange={(v) => setPaymentMethodId(v ?? "none")}
                items={paymentItems}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {paymentMethods.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="url">Website (optional)</Label>
              <Input
                id="url"
                name="url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="trialEndDate">Trial ends (optional)</Label>
              <Input
                id="trialEndDate"
                name="trialEndDate"
                type="date"
                defaultValue={subscription?.trialEndDate ?? ""}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input
              id="notes"
              name="notes"
              defaultValue={subscription?.notes ?? ""}
              placeholder="Family plan, shared with…"
            />
          </div>

          <input type="hidden" name="logoUrl" value={logoUrl ?? ""} />

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">Counts toward your totals</p>
            </div>
            <Switch name="active" defaultChecked={subscription?.active ?? true} />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Renewal reminders</p>
              <p className="text-xs text-muted-foreground">Notify before it renews</p>
            </div>
            <Switch name="notify" defaultChecked={subscription?.notify ?? true} />
          </div>

          <SheetFooter className="mt-auto flex-row gap-2 px-0">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={pending}>
              {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {isEdit ? "Save changes" : "Add subscription"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
