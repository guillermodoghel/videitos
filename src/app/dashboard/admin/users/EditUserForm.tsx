"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-900 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-400";

type User = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

export function EditUserForm({ user }: { user: User }) {
  const router = useRouter();
  const [email, setEmail] = useState(user.email);
  const [name, setName] = useState(user.name ?? "");
  const [role, setRole] = useState(user.role);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSubmitting(true);
    try {
      const body: { email: string; name?: string; role: string; password?: string } = {
        email: email.trim(),
        name: name.trim() || undefined,
        role,
      };
      if (password.length >= 8) body.password = password;

      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Failed to update user" });
        return;
      }
      router.push("/dashboard/admin/users");
      router.refresh();
    } catch {
      setMessage({ type: "error", text: "Something went wrong" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md space-y-4">
      <div>
        <label htmlFor="edit-user-email" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Email
        </label>
        <input
          id="edit-user-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="off"
          className={input}
        />
      </div>
      <div>
        <label htmlFor="edit-user-name" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Name (optional)
        </label>
        <input
          id="edit-user-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          className={input}
          placeholder="Display name"
        />
      </div>
      <div>
        <label htmlFor="edit-user-role" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Role
        </label>
        <select
          id="edit-user-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className={input}
        >
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </div>
      <div>
        <label htmlFor="edit-user-password" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          New password (leave blank to keep current)
        </label>
        <input
          id="edit-user-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          autoComplete="new-password"
          className={input}
          placeholder="At least 8 characters"
        />
      </div>
      {message && (
        <p
          className={
            message.type === "ok"
              ? "text-sm text-green-600 dark:text-green-400"
              : "text-sm text-red-600 dark:text-red-400"
          }
        >
          {message.text}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
