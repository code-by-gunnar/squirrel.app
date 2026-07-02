import { SubscriptionsView } from "@/components/subscriptions-view";
import {
  listSubscriptions,
  getCategories,
  getPaymentMethods,
} from "@/lib/subscriptions";
import { getBaseCurrency } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default function SubscriptionsPage() {
  const subscriptions = listSubscriptions();
  const categories = getCategories();
  const paymentMethods = getPaymentMethods();
  const baseCurrency = getBaseCurrency();

  return (
    <SubscriptionsView
      subscriptions={subscriptions}
      categories={categories}
      paymentMethods={paymentMethods}
      baseCurrency={baseCurrency}
    />
  );
}
