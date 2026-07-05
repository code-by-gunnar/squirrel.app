import { AppShell } from "@/components/app-shell";
import { getContexts } from "@/lib/subscriptions";
import { getActiveContextFilter } from "@/lib/contexts";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const contexts = getContexts();
  const active = await getActiveContextFilter();
  return (
    <AppShell contexts={contexts} activeContext={String(active)}>
      {children}
    </AppShell>
  );
}
