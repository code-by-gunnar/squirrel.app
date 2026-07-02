"use client";

import { useActionState, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import type { Subscription, Category, PaymentMethod } from "@/db/schema";
import { saveSubscription, type SaveState } from "@/app/(app)/subscriptions/actions";
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

  // Reset local state when the target subscription changes.
  useEffect(() => {
    setCurrency(subscription?.currencyCode ?? baseCurrency);
    setCycle(subscription?.billingCycle ?? "month");
    setCategoryId(subscription?.categoryId ? String(subscription.categoryId) : "none");
    setPaymentMethodId(
      subscription?.paymentMethodId ? String(subscription.paymentMethodId) : "none",
    );
  }, [subscription, baseCurrency]);

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

          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={subscription?.name ?? ""}
              placeholder="Netflix"
            />
          </div>

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
              <Select value={cycle} onValueChange={(v) => setCycle(v ?? "month")}>
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
              <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "none")}>
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
                defaultValue={subscription?.url ?? ""}
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

          <input type="hidden" name="logoUrl" value={subscription?.logoUrl ?? ""} />

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
