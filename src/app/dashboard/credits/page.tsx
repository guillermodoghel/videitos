import { CreditsView } from "./CreditsView";

export default function CreditsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Credits
      </h1>
      <CreditsView />
    </div>
  );
}
