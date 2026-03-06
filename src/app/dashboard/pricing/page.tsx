import { PricingPageContent } from "./PricingPageContent";

export default function PricingPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Pricing
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Credit cost by model and an estimator for your videos.
        </p>
      </div>
      <PricingPageContent />
    </div>
  );
}
