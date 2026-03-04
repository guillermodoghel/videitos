"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ASPECT_RATIOS,
  RESOLUTIONS,
  DURATIONS,
  VEO_DEFAULTS,
  type VeoConfig,
} from "@/lib/video-models";
import { DropboxFolderPicker } from "./DropboxFolderPicker";

type ModelOption = { id: string; name: string; description: string };

type Props = {
  models: readonly ModelOption[];
  templateId?: string;
  initialName?: string;
  initialModel?: string;
  initialEnabled?: boolean;
  initialConfig?: VeoConfig;
  initialDropboxSourcePath?: string | null;
  initialDropboxDestinationPath?: string | null;
};

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-900 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-400";

export function TemplateForm({
  models,
  templateId,
  initialName = "",
  initialModel = models[0]?.id ?? "",
  initialEnabled = true,
  initialConfig,
  initialDropboxSourcePath = null,
  initialDropboxDestinationPath = null,
}: Props) {
  const router = useRouter();
  const config = initialConfig ?? VEO_DEFAULTS;

  const [name, setName] = useState(initialName);
  const [model, setModel] = useState(initialModel);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [prompt, setPrompt] = useState(config.prompt);
  const [aspectRatio, setAspectRatio] = useState<VeoConfig["aspectRatio"]>(config.aspectRatio);
  const [resolution, setResolution] = useState<VeoConfig["resolution"]>(config.resolution);
  const [durationSeconds, setDurationSeconds] = useState<VeoConfig["durationSeconds"]>(config.durationSeconds);
  const [dropboxConnected, setDropboxConnected] = useState(false);
  const [dropboxSourcePath, setDropboxSourcePath] = useState(initialDropboxSourcePath ?? "");
  const [dropboxDestinationPath, setDropboxDestinationPath] = useState(initialDropboxDestinationPath ?? "");
  const existingRefs = config.referenceImageUrls ?? [];
  const [refFile0, setRefFile0] = useState<File | null>(null);
  const [refFile1, setRefFile1] = useState<File | null>(null);
  const [preview0, setPreview0] = useState<string | null>(null);
  const [preview1, setPreview1] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/dropbox/status")
      .then((res) => res.json())
      .then((data) => setDropboxConnected(!!data.connected))
      .catch(() => setDropboxConnected(false));
  }, []);

  useEffect(() => {
    if (!refFile0) {
      setPreview0(null);
      return;
    }
    const url = URL.createObjectURL(refFile0);
    setPreview0(url);
    return () => URL.revokeObjectURL(url);
  }, [refFile0]);

  useEffect(() => {
    if (!refFile1) {
      setPreview1(null);
      return;
    }
    const url = URL.createObjectURL(refFile1);
    setPreview1(url);
    return () => URL.revokeObjectURL(url);
  }, [refFile1]);

  function refDisplayUrl(index: number): string | null {
    if (index === 0 && preview0) return preview0;
    if (index === 1 && preview1) return preview1;
    const keyOrUrl = existingRefs[index];
    if (!keyOrUrl) return null;
    if (keyOrUrl.startsWith("http://") || keyOrUrl.startsWith("https://")) return keyOrUrl;
    return `/api/templates/references/url?key=${encodeURIComponent(keyOrUrl)}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const configPayload = {
      prompt: prompt.trim(),
      aspectRatio,
      resolution,
      durationSeconds,
      referenceImageUrls: templateId ? existingRefs : [],
    };
    try {
      const url = templateId ? `/api/templates/${templateId}` : "/api/templates";
      const method = templateId ? "PATCH" : "POST";
      const formData = new FormData();
      formData.set("config", JSON.stringify(configPayload));
      formData.set("name", name.trim());
      if (dropboxSourcePath) formData.set("dropboxSourcePath", dropboxSourcePath);
      if (dropboxDestinationPath) formData.set("dropboxDestinationPath", dropboxDestinationPath);
      if (templateId) {
        formData.set("enabled", String(enabled));
      } else {
        formData.set("model", model);
      }
      if (refFile0) formData.set("reference0", refFile0);
      if (refFile1) formData.set("reference1", refFile1);

      const res = await fetch(url, { method, body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to save");
        return;
      }
      router.push("/dashboard/templates");
      router.refresh();
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}

      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={inputClass}
          placeholder="My video template"
        />
      </div>

      <div>
        <label htmlFor="model" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Model
        </label>
        <select
          id="model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className={inputClass}
          disabled={!!templateId}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {!templateId && models.find((m) => m.id === model)?.description && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {models.find((m) => m.id === model)?.description}
          </p>
        )}
      </div>

      {templateId && (
        <div className="flex items-center gap-2">
          <input
            id="enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800"
          />
          <label htmlFor="enabled" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Enabled
          </label>
        </div>
      )}

      <div>
        <label htmlFor="prompt" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Prompt
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          className={inputClass}
          placeholder="Describe the video you want to generate..."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="aspectRatio" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Aspect ratio
          </label>
          <select
            id="aspectRatio"
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as VeoConfig["aspectRatio"])}
            className={inputClass}
          >
            {ASPECT_RATIOS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="resolution" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Resolution
          </label>
          <select
            id="resolution"
            value={resolution}
            onChange={(e) => setResolution(e.target.value as VeoConfig["resolution"])}
            className={inputClass}
          >
            {RESOLUTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="durationSeconds" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Duration
          </label>
          <select
            id="durationSeconds"
            value={durationSeconds}
            onChange={(e) => setDurationSeconds(Number(e.target.value) as VeoConfig["durationSeconds"])}
            className={inputClass}
          >
            {DURATIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <span className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Reference images (optional, up to 2)
        </span>
        <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
          Upload PNG, JPEG or WebP (max 10 MB). Stored in your private S3 bucket.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
              Reference 1
            </label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              onChange={(e) => setRefFile0(e.target.files?.[0] ?? null)}
              className={inputClass}
            />
            {refDisplayUrl(0) && (
              <img
                src={refDisplayUrl(0)!}
                alt="Ref 1"
                className="mt-2 max-h-32 rounded border border-zinc-200 object-contain dark:border-zinc-700"
              />
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
              Reference 2
            </label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              onChange={(e) => setRefFile1(e.target.files?.[0] ?? null)}
              className={inputClass}
            />
            {refDisplayUrl(1) && (
              <img
                src={refDisplayUrl(1)!}
                alt="Ref 2"
                className="mt-2 max-h-32 rounded border border-zinc-200 object-contain dark:border-zinc-700"
              />
            )}
          </div>
        </div>
      </div>

      <div>
        <span className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Dropbox folders
        </span>
        {!dropboxConnected ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connect Dropbox to choose a source and destination folder for this template.{" "}
            <a
              href="/api/dropbox/auth"
              className="inline-flex rounded-lg bg-[#0061ff] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0052d9]"
            >
              Connect to Dropbox
            </a>
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <DropboxFolderPicker
              label="Source folder"
              value={dropboxSourcePath}
              onChange={setDropboxSourcePath}
            />
            <DropboxFolderPicker
              label="Destination folder"
              value={dropboxDestinationPath}
              onChange={setDropboxDestinationPath}
            />
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {saving ? "Saving…" : templateId ? "Save changes" : "Create template"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
