"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  ExternalLink,
  Search,
  CreditCard,
  Wallet,
  Ban,
  RotateCcw,
  LoaderCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { Category, Context, PaymentMethod, Subscription } from "@/db/schema";
import type { EnrichedSubscription } from "@/lib/subscriptions";
import { describeCycle, type BillingCycle } from "@/lib/billing";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import {
  deleteSubscription,
  cancelSubscription,
  reactivateSubscription,
  topUp,
} from "@/app/(app)/subscriptions/actions";
import { SubscriptionSheet } from "@/components/subscription-sheet";
import { SubscriptionLogo } from "@/components/subscription-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  subscriptions: EnrichedSubscription[];
  categories: Category[];
  contexts: Context[];
  paymentMethods: PaymentMethod[];
  baseCurrency: string;
  defaultContextId?: string;
};

type SortKey = "renewal" | "name" | "price";

function renewalLabel(days: number): { text: string; tone: string } {
  if (days === 0) return { text: "Due today", tone: "text-amber-600 dark:text-amber-400" };
  if (days === 1) return { text: "Tomorrow", tone: "text-amber-600 dark:text-amber-400" };
  if (days <= 7) return { text: `in ${days} days`, tone: "text-amber-600 dark:text-amber-400" };
  return { text: `in ${days} days`, tone: "text-muted-foreground" };
}

/** The badge shown next to a subscription's name, if any. */
function statusBadge(
  sub: EnrichedSubscription,
): { label: string; className: string } | null {
  if (sub.prepaid && sub.status === "active") {
    return {
      label: "Prepaid",
      className:
        "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/40 dark:text-violet-400",
    };
  }
  switch (sub.status) {
    case "cancelled":
      return {
        label: "Cancelled",
        className:
          "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-400",
      };
    case "expired":
      return { label: "Expired", className: "" };
    case "inactive":
      return { label: "Inactive", className: "" };
    default:
      return null;
  }
}

/** The bottom-right line: a renewal countdown, or an end/expiry date for cancelled subs. */
function statusLine(
  sub: EnrichedSubscription,
): { text: string; tone: string; sub?: string } {
  if (sub.prepaid && sub.status === "active") {
    if (sub.depletesOn === null) {
      return { text: "Prepaid", tone: "text-muted-foreground" };
    }
    const d = sub.daysUntilDepletion ?? 0;
    if (d < 0) {
      return { text: `Ran out ~${sub.depletesOn}`, tone: "text-muted-foreground", sub: sub.depletesOn };
    }
    const text = d === 0 ? "Runs out today" : d === 1 ? "Runs out tomorrow" : `Runs out in ${d} days`;
    const tone = d <= 7 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";
    return { text, tone, sub: sub.depletesOn };
  }
  if (sub.status === "cancelled") {
    const d = sub.daysUntilEnd ?? 0;
    const text = d <= 0 ? "Ends today" : d === 1 ? "Ends tomorrow" : `Ends in ${d} days`;
    return { text, tone: "text-amber-600 dark:text-amber-400", sub: sub.endsOn ?? undefined };
  }
  if (sub.status === "expired") {
    return { text: "Expired", tone: "text-muted-foreground", sub: sub.endsOn ?? undefined };
  }
  if (sub.status === "inactive") {
    return { text: "Inactive", tone: "text-muted-foreground" };
  }
  const rl = renewalLabel(sub.daysUntil);
  return { text: rl.text, tone: rl.tone, sub: sub.nextRenewal };
}

export function SubscriptionsView({
  subscriptions,
  categories,
  contexts,
  paymentMethods,
  baseCurrency,
  defaultContextId,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnrichedSubscription | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [topUpTarget, setTopUpTarget] = useState<EnrichedSubscription | null>(null);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("renewal");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");

  const visible = useMemo(() => {
    let items = [...subscriptions];
    if (query.trim()) {
      const q = query.toLowerCase();
      items = items.filter((s) => s.name.toLowerCase().includes(q));
    }
    if (categoryFilter !== "all") {
      items = items.filter((s) => String(s.categoryId) === categoryFilter);
    }
    if (statusFilter === "active") items = items.filter((s) => s.isActive);
    if (statusFilter === "cancelled") items = items.filter((s) => s.status === "cancelled");
    if (statusFilter === "free") items = items.filter((s) => s.free);
    if (statusFilter === "inactive") items = items.filter((s) => !s.isActive);

    items.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      // Sort by the actual charge shown on the card (converted to the base
      // currency so mixed currencies compare), not the monthly-equivalent —
      // otherwise a £120/yr sub sorts below a £15/mo one despite showing £120.
      if (sort === "price") return b.priceBase - a.priceBase;
      return a.daysUntil - b.daysUntil;
    });
    return items;
  }, [subscriptions, query, categoryFilter, statusFilter, sort]);

  function openAdd() {
    setEditing(null);
    setSheetOpen(true);
  }
  function openEdit(sub: Subscription) {
    setEditing(sub);
    setSheetOpen(true);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await deleteSubscription(deleteTarget.id);
    setDeleting(false);
    if (res.error) toast.error(res.error);
    else toast.success("Subscription deleted");
    setDeleteTarget(null);
  }

  async function doCancel(id: number) {
    const res = await cancelSubscription(id);
    if (res.error) toast.error(res.error);
    else toast.success("Marked as cancelled — active until it expires");
  }
  async function doReactivate(id: number) {
    const res = await reactivateSubscription(id);
    if (res.error) toast.error(res.error);
    else toast.success("Reactivated");
  }

  // Value -> label maps so closed filters show the label, not the raw value.
  const categoryFilterItems: Record<string, string> = {
    all: "All categories",
    ...Object.fromEntries(categories.map((c) => [String(c.id), c.name])),
  };
  const statusItems: Record<string, string> = {
    active: "Active",
    cancelled: "Cancelled",
    free: "Free",
    inactive: "Inactive",
    all: "All",
  };
  const sortItems: Record<string, string> = {
    renewal: "Next renewal",
    name: "Name",
    price: "Price (high–low)",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">
            {subscriptions.filter((s) => s.isActive).length} active
            {subscriptions.filter((s) => s.status === "cancelled").length > 0
              ? ` · ${subscriptions.filter((s) => s.status === "cancelled").length} cancelled`
              : ""}
          </p>
        </div>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="size-4" />
          Add subscription
        </Button>
      </div>

      {/* Toolbar: search on its own row on mobile, filters beneath it */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-3 gap-2 sm:flex sm:w-auto">
          <Select
            value={categoryFilter}
            onValueChange={(v) => setCategoryFilter(v ?? "all")}
            items={categoryFilterItems}
          >
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v ?? "active")}
            items={statusItems}
          >
            <SelectTrigger className="w-full sm:w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={sort}
            onValueChange={(v) => v && setSort(v as SortKey)}
            items={sortItems}
          >
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="renewal">Next renewal</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="price">Price (high–low)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Grid / empty state */}
      {visible.length === 0 ? (
        <EmptyState
          hasAny={subscriptions.length > 0}
          onAdd={openAdd}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((sub) => {
            const badge = sub.free
              ? {
                  label: "Free",
                  className:
                    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-400",
                }
              : statusBadge(sub);
            const line = statusLine(sub);
            return (
              <div
                key={sub.id}
                className={cn(
                  "group relative flex flex-col rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md",
                  !sub.isActive && "opacity-60",
                )}
              >
                <div className="flex items-start gap-3">
                  <SubscriptionLogo
                    name={sub.name}
                    logoUrl={sub.logoUrl}
                    color={sub.categoryColor}
                    size="md"
                  />
                  <div className="flex min-w-0 flex-1 items-center gap-2 self-center">
                    <p className="truncate font-medium">{sub.name}</p>
                    {badge ? (
                      <Badge
                        variant="secondary"
                        className={cn("shrink-0 text-[10px]", badge.className)}
                      >
                        {badge.label}
                      </Badge>
                    ) : null}
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 text-muted-foreground"
                        />
                      }
                    >
                      <MoreVertical className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {sub.prepaid ? (
                        <DropdownMenuItem onClick={() => setTopUpTarget(sub)}>
                          <Plus className="size-4" />
                          Top up
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onClick={() => openEdit(sub)}>
                        <Pencil className="size-4" />
                        Edit
                      </DropdownMenuItem>
                      {sub.url ? (
                        <DropdownMenuItem
                          render={
                            <Link
                              href={sub.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          }
                        >
                          <ExternalLink className="size-4" />
                          Visit site
                        </DropdownMenuItem>
                      ) : null}
                      {sub.status === "active" ? (
                        <DropdownMenuItem onClick={() => doCancel(sub.id)}>
                          <Ban className="size-4" />
                          Mark cancelled
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => doReactivate(sub.id)}>
                          <RotateCcw className="size-4" />
                          Reactivate
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeleteTarget(sub)}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="mt-4 flex items-end justify-between">
                  <div>
                    {sub.free ? (
                      <p className="text-lg font-semibold">Free</p>
                    ) : sub.prepaid ? (
                      <>
                        <p className="text-lg font-semibold">
                          {formatCurrency(sub.price, sub.currencyCode)}
                        </p>
                        <p className="text-xs text-muted-foreground">credits</p>
                      </>
                    ) : (
                      <>
                        <p className="text-lg font-semibold">
                          {formatCurrency(sub.price, sub.currencyCode)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {describeCycle(sub.billingCycle as BillingCycle, sub.billingInterval)}
                          {sub.currencyCode !== baseCurrency
                            ? ` · ${formatCurrency(sub.monthlyBase, baseCurrency)}/mo`
                            : ""}
                        </p>
                      </>
                    )}
                  </div>
                  {!sub.free ? (
                    <div className="text-right">
                      <p className={`text-sm font-medium ${line.tone}`}>{line.text}</p>
                      {line.sub ? (
                        <p className="text-xs text-muted-foreground">{line.sub}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {sub.categoryName || sub.contextName || sub.paymentMethodName ? (
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                    {sub.categoryName ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: sub.categoryColor ?? "#64748b" }}
                        />
                        {sub.categoryName}
                      </span>
                    ) : null}
                    {sub.contextName ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: sub.contextColor ?? "#64748b" }}
                        />
                        {sub.contextName}
                      </span>
                    ) : null}
                    {sub.paymentMethodName ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Wallet className="size-3.5" />
                        {sub.paymentMethodName}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <SubscriptionSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        categories={categories}
        contexts={contexts}
        paymentMethods={paymentMethods}
        baseCurrency={baseCurrency}
        subscription={editing}
        defaultContextId={defaultContextId}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete subscription?</DialogTitle>
            <DialogDescription>
              This permanently removes <strong>{deleteTarget?.name}</strong>. This
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TopUpDialog target={topUpTarget} onClose={() => setTopUpTarget(null)} />
    </div>
  );
}

function TopUpDialog({
  target,
  onClose,
}: {
  target: EnrichedSubscription | null;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [runsOut, setRunsOut] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (target) {
      setAmount(String(target.price ?? ""));
      setDate(new Date().toISOString().slice(0, 10));
      setRunsOut(target.depletesOn ?? "");
    }
  }, [target]);

  async function submit() {
    if (!target) return;
    const amt = Number(amount);
    if (!(amt > 0)) {
      toast.error("Enter an amount greater than 0");
      return;
    }
    setPending(true);
    const res = await topUp(target.id, amt, date, runsOut || null);
    setPending(false);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Topped up");
      onClose();
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Top up {target?.name}</DialogTitle>
          <DialogDescription>
            Records a one-off charge and updates when it runs out.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tuAmount">Amount ({target?.currencyCode})</Label>
              <Input id="tuAmount" type="number" step="0.01" min="0" value={amount}
                onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tuDate">Date</Label>
              <Input id="tuDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tuRunsOut">Runs out around (optional)</Label>
            <Input id="tuRunsOut" type="date" value={runsOut} onChange={(e) => setRunsOut(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Top up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ hasAny, onAdd }: { hasAny: boolean; onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <CreditCard className="size-6" />
      </div>
      <p className="mt-4 font-medium">
        {hasAny ? "No subscriptions match your filters" : "No subscriptions yet"}
      </p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        {hasAny
          ? "Try clearing the search or filters."
          : "Add your first subscription to start tracking what you spend."}
      </p>
      {!hasAny ? (
        <Button onClick={onAdd} className="mt-4 gap-2">
          <Plus className="size-4" />
          Add subscription
        </Button>
      ) : null}
    </div>
  );
}
