"use client";

import { useActionState } from "react";
import { Squirrel, LoaderCircle } from "lucide-react";
import { login, type LoginState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Squirrel className="size-7" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Squirrel</h1>
            <p className="text-sm text-muted-foreground">
              Your subscriptions, stashed in one place.
            </p>
          </div>
        </div>

        <form
          action={formAction}
          className="rounded-2xl border bg-card p-6 shadow-sm"
        >
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              placeholder="••••••••"
              aria-invalid={!!state.error}
            />
            {state.error ? (
              <p className="text-sm text-destructive">{state.error}</p>
            ) : null}
          </div>

          <Button type="submit" className="mt-5 w-full" disabled={pending}>
            {pending ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
      </div>
    </main>
  );
}
