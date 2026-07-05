import { SubscriptionsView } from "@/components/subscriptions-view";
import {
  listSubscriptions,
  getCategories,
  getContexts,
  getPaymentMethods,
} from "@/lib/subscriptions";
import { getBaseCurrency } from "@/lib/settings";
import { getActiveContextFilter } from "@/lib/contexts";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const filter = await getActiveContextFilter();
  const subscriptions = listSubscriptions(filter);
  const categories = getCategories();
  const contexts = getContexts();
  const paymentMethods = getPaymentMethods();
  const baseCurrency = getBaseCurrency();
  // When a context is active, new subs default to it.
  const defaultContextId = typeof filter === "number" ? String(filter) : "none";

  return (
    <SubscriptionsView
      subscriptions={subscriptions}
      categories={categories}
      contexts={contexts}
      paymentMethods={paymentMethods}
      baseCurrency={baseCurrency}
      defaultContextId={defaultContextId}
    />
  );
}
