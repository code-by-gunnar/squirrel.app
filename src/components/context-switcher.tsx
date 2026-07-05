"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import type { Context } from "@/db/schema";
import { setActiveContext } from "@/lib/context-actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ContextSwitcher({
  contexts,
  current,
}: {
  contexts: Context[];
  current: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const items: Record<string, string> = {
    all: "All contexts",
    unassigned: "Unassigned",
    ...Object.fromEntries(contexts.map((c) => [String(c.id), c.name])),
  };

  function onChange(value: string | null) {
    const next = value ?? "all";
    start(async () => {
      await setActiveContext(next);
      router.refresh();
    });
  }

  return (
    <Select value={current} onValueChange={onChange} items={items}>
      <SelectTrigger
        className="h-9 w-auto gap-1.5 border-none bg-transparent px-2 text-sm text-muted-foreground shadow-none hover:text-foreground data-[disabled]:opacity-100"
        disabled={pending}
        aria-label="Filter by context"
      >
        <Layers className="size-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="all">All contexts</SelectItem>
        {contexts.map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            <span className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: c.color }}
              />
              {c.name}
            </span>
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value="unassigned">Unassigned</SelectItem>
      </SelectContent>
    </Select>
  );
}
