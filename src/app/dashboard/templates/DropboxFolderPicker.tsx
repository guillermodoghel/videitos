"use client";

import { useState, useEffect, useCallback } from "react";

type FolderEntry = {
  name: string;
  tag: string;
  path_display: string;
  path_lower: string;
  isFolder: boolean;
};

type Props = {
  label: string;
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
};

export function DropboxFolderPicker({ label, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);

  const loadFolder = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dropbox/folders?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load folder");
        setEntries([]);
        return;
      }
      setEntries(data.entries ?? []);
    } catch {
      setError("Failed to load");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setCurrentPath("");
      loadFolder("");
    }
  }, [open, loadFolder]);

  async function handleCreateFolder() {
    const path = currentPath ? `${currentPath}/${newFolderName}` : `/${newFolderName}`;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/dropbox/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create folder");
        return;
      }
      setNewFolderName("");
      await loadFolder(currentPath);
    } catch {
      setError("Failed to create folder");
    } finally {
      setCreating(false);
    }
  }

  function handleSelectFolder(entry: FolderEntry) {
    if (!entry.isFolder) return;
    const path = entry.path_display || entry.path_lower || "";
    onChange(path);
    setOpen(false);
  }

  function handleNavigateInto(entry: FolderEntry) {
    if (!entry.isFolder) return;
    const path = entry.path_display || entry.path_lower || "";
    setCurrentPath(path);
    loadFolder(path);
  }

  function handleGoUp() {
    if (!currentPath) return;
    const parent = currentPath.split("/").slice(0, -1).join("/") || "";
    setCurrentPath(parent);
    loadFolder(parent);
  }

  const onlyFolders = entries.filter((e) => e.isFolder);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          readOnly
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400"
          placeholder="No folder selected"
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-50"
        >
          Browse
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-lg dark:bg-zinc-900">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                Select folder
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400"
              >
                ✕
              </button>
            </div>
            {currentPath ? (
              <button
                type="button"
                onClick={handleGoUp}
                className="mb-2 text-sm text-zinc-700 hover:underline dark:text-zinc-400"
              >
                ↑ Parent folder
              </button>
            ) : null}
            {loading ? (
              <p className="py-4 text-sm text-zinc-600 dark:text-zinc-400">Loading…</p>
            ) : error ? (
              <p className="py-2 text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto rounded border border-zinc-200 p-2 dark:border-zinc-700">
                {onlyFolders.length === 0 ? (
                  <li className="py-2 text-sm text-zinc-600 dark:text-zinc-400">No folders</li>
                ) : (
                  onlyFolders.map((e) => (
                    <li key={e.path_lower || e.name}>
                      <button
                        type="button"
                        onClick={() => handleNavigateInto(e)}
                        className="w-full rounded px-2 py-1.5 text-left text-sm text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                      >
                        📁 {e.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectFolder(e)}
                        className="ml-2 text-xs text-zinc-600 hover:underline dark:text-zinc-400"
                      >
                        Use this folder
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
            <div className="mt-3 flex gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder name"
                className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-400"
              />
              <button
                type="button"
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim() || creating}
                className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {creating ? "Creating…" : "New folder"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
