import { CalendarView } from "@/components/calendar-view";
import { listSubscriptions } from "@/lib/subscriptions";
import { getBaseCurrency } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default function CalendarPage() {
  return (
    <CalendarView
      subscriptions={listSubscriptions()}
      baseCurrency={getBaseCurrency()}
    />
  );
}
