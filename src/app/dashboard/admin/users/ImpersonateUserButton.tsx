"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ImpersonateUserButton({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onImpersonate() {
    if (
      !confirm(
        `Impersonate ${email}? You will see the app as this user until you stop impersonating.`
      )
    ) {
      return;
    }

    setPending(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/impersonate`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Impersonation failed");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      alert("Impersonation failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onImpersonate}
      disabled={pending}
      className="font-medium text-amber-700 hover:text-amber-900 disabled:opacity-50 dark:text-amber-400 dark:hover:text-amber-300"
    >
      {pending ? "Starting…" : "Impersonate"}
    </button>
  );
}
