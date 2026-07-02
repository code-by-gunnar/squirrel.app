"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Squirrel,
  LayoutDashboard,
  CreditCard,
  CalendarDays,
  Settings,
  Menu,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { logout } from "@/app/login/actions";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Squirrel className="size-5" />
      </div>
      <span className="text-lg font-semibold tracking-tight">Squirrel</span>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-svh w-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card/50 md:flex">
        <div className="flex h-16 items-center border-b px-4">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks />
        </div>
        <div className="border-t p-3">
          <form action={logout}>
            <Button
              variant="ghost"
              type="submit"
              className="w-full justify-start gap-3 text-muted-foreground"
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r bg-card p-3 shadow-xl">
            <div className="flex h-12 items-center">
              <Brand />
            </div>
            <div className="mt-4 flex-1">
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </div>
            <form action={logout}>
              <Button variant="ghost" type="submit" className="w-full justify-start gap-3">
                <LogOut className="size-4" />
                Sign out
              </Button>
            </form>
          </div>
        </div>
      ) : null}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </Button>
          <div className="md:hidden">
            <Brand />
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
