"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  ExternalLink,
  Search,
  CreditCard,
} from "lucide-react";
import { toast } from "sonner";
import type { Category, PaymentMethod, Subscription } from "@/db/schema";
import type { EnrichedSubscription } from "@/lib/subscriptions";
import { describeCycle, type BillingCycle } from "@/lib/billing";
import { formatCurrency } from "@/lib/currency";
import { deleteSubscription } from "@/app/(app)/subscriptions/actions";
import { SubscriptionSheet } from "@/components/subscription-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  paymentMethods: PaymentMethod[];
  baseCurrency: string;
};

type SortKey = "renewal" | "name" | "price";

function renewalLabel(days: number): { text: string; tone: string } {
  if (days === 0) return { text: "Due today", tone: "text-amber-600 dark:text-amber-400" };
  if (days === 1) return { text: "Tomorrow", tone: "text-amber-600 dark:text-amber-400" };
  if (days <= 7) return { text: `in ${days} days`, tone: "text-amber-600 dark:text-amber-400" };
  return { text: `in ${days} days`, tone: "text-muted-foreground" };
}

function SubLogo({ sub }: { sub: EnrichedSubscription }) {
  const color = sub.categoryColor ?? "#64748b";
  if (sub.logoUrl) {
    return (
      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-background">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={sub.logoUrl} alt="" className="size-full object-contain p-1" />
      </div>
    );
  }
  return (
    <div
      className="flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {sub.name.charAt(0).toUpperCase()}
    </div>
  );
}

export function SubscriptionsView({
  subscriptions,
  categories,
  paymentMethods,
  baseCurrency,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnrichedSubscription | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    if (statusFilter === "active") items = items.filter((s) => s.active);
    if (statusFilter === "inactive") items = items.filter((s) => !s.active);

    items.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "price") return b.monthlyBase - a.monthlyBase;
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">
            {subscriptions.filter((s) => s.active).length} active
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
          <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v ?? "all")}>
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
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "active")}>
            <SelectTrigger className="w-full sm:w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => v && setSort(v as SortKey)}>
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
            const rl = renewalLabel(sub.daysUntil);
            return (
              <div
                key={sub.id}
                className="group relative flex flex-col rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <SubLogo sub={sub} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{sub.name}</p>
                      {!sub.active ? (
                        <Badge variant="secondary" className="text-[10px]">
                          Inactive
                        </Badge>
                      ) : null}
                    </div>
                    {sub.categoryName ? (
                      <span
                        className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: sub.categoryColor ?? "#64748b" }}
                        />
                        {sub.categoryName}
                      </span>
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
                    <p className="text-lg font-semibold">
                      {formatCurrency(sub.price, sub.currencyCode)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {describeCycle(sub.billingCycle as BillingCycle, sub.billingInterval)}
                      {sub.currencyCode !== baseCurrency
                        ? ` · ${formatCurrency(sub.monthlyBase, baseCurrency)}/mo`
                        : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-medium ${rl.tone}`}>{rl.text}</p>
                    <p className="text-xs text-muted-foreground">{sub.nextRenewal}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SubscriptionSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        categories={categories}
        paymentMethods={paymentMethods}
        baseCurrency={baseCurrency}
        subscription={editing}
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
    </div>
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
