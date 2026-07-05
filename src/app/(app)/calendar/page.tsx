import { CalendarView } from "@/components/calendar-view";
import { listSubscriptions } from "@/lib/subscriptions";
import { getBaseCurrency } from "@/lib/settings";
import { getActiveContextFilter } from "@/lib/contexts";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const filter = await getActiveContextFilter();
  return (
    <CalendarView
      subscriptions={listSubscriptions(filter)}
      baseCurrency={getBaseCurrency()}
    />
  );
}
