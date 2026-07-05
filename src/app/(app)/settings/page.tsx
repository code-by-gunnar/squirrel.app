import { SettingsView } from "@/components/settings-view";
import { getSettings } from "@/lib/settings";
import { getCategories, getContexts, getPaymentMethods } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <SettingsView
      settings={getSettings()}
      categories={getCategories()}
      contexts={getContexts()}
      paymentMethods={getPaymentMethods()}
    />
  );
}
