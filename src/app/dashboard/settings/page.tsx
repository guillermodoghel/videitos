import { Suspense } from "react";
import { GoogleAiKeyForm } from "./GoogleAiKeyForm";
import { DropboxConnect } from "./DropboxConnect";

export default function DashboardSettingsPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Settings
      </h1>
      <GoogleAiKeyForm />
      <Suspense fallback={<div className="text-sm text-zinc-500">Loading…</div>}>
        <DropboxConnect />
      </Suspense>
    </div>
  );
}
