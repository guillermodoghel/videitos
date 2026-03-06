"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  ASPECT_RATIOS,
  RESOLUTIONS,
  DURATIONS,
  VEO_DEFAULTS,
  isRunwayImageToVideoModel,
  RUNWAY_GEN4_RATIOS,
  RUNWAY_VEO31_RATIOS,
  RUNWAY_GEN4_DURATIONS,
  RUNWAY_VEO31_DURATIONS,
  type VeoConfig,
  type RunwayGen4Ratio,
  type RunwayVeo31Ratio,
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const config = initialConfig ?? VEO_DEFAULTS;

  const [name, setName] = useState(initialName);
  const [model, setModel] = useState(initialModel);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [prompt, setPrompt] = useState(config.prompt);
  const [aspectRatio, setAspectRatio] = useState<VeoConfig["aspectRatio"]>(config.aspectRatio);
  const [resolution, setResolution] = useState<VeoConfig["resolution"]>(config.resolution);
  const [durationSeconds, setDurationSeconds] = useState<VeoConfig["durationSeconds"]>(config.durationSeconds);
  const [runwayRatio, setRunwayRatio] = useState<string>(
    config.runwayRatio ?? (config.aspectRatio === "16:9" ? "1280:720" : "720:1280")
  );
  const [runwayAudio, setRunwayAudio] = useState(
    config.audio ?? (initialModel === "veo3.1" || initialModel === "veo3.1_fast" ? true : false)
  );
  const [dropboxConnected, setDropboxConnected] = useState(false);
  const [dropboxSourcePath, setDropboxSourcePath] = useState(initialDropboxSourcePath ?? "");
  const [dropboxDestinationPath, setDropboxDestinationPath] = useState(initialDropboxDestinationPath ?? "");
  const existingRefs = config.referenceImageUrls ?? [];
  const existingPreGenRefs = config.preGen?.referenceImageUrls ?? [];
  const [refFile0, setRefFile0] = useState<File | null>(null);
  const [refFile1, setRefFile1] = useState<File | null>(null);
  const [preview0, setPreview0] = useState<string | null>(null);
  const [preview1, setPreview1] = useState<string | null>(null);
  const [preGenPrompt, setPreGenPrompt] = useState(config.preGen?.prompt ?? "");
  const [preGenRefFile0, setPreGenRefFile0] = useState<File | null>(null);
  const [preGenRefFile1, setPreGenRefFile1] = useState<File | null>(null);
  const [preGenPreview0, setPreGenPreview0] = useState<string | null>(null);
  const [preGenPreview1, setPreGenPreview1] = useState<string | null>(null);
  const [preGenExpanded, setPreGenExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/dropbox/status")
      .then((res) => res.json())
      .then((data) => setDropboxConnected(!!data.connected))
      .catch(() => setDropboxConnected(false));
  }, []);

  // After OAuth redirect with ?dropbox=connected, refetch status so folder pickers appear
  useEffect(() => {
    if (searchParams.get("dropbox") === "connected") {
      fetch("/api/dropbox/status")
        .then((res) => res.json())
        .then((data) => setDropboxConnected(!!data.connected));
    }
  }, [searchParams]);

  const isGen4 = model === "gen4.5" || model === "gen4_turbo";
  const isVeo31 = model === "veo3.1" || model === "veo3.1_fast";
  const runwayRatios = isGen4 ? RUNWAY_GEN4_RATIOS : RUNWAY_VEO31_RATIOS;
  const runwayDurations = isGen4 ? RUNWAY_GEN4_DURATIONS : RUNWAY_VEO31_DURATIONS;

  useEffect(() => {
    if (!isRunwayImageToVideoModel(model)) return;
    const ratios = model === "gen4.5" || model === "gen4_turbo" ? RUNWAY_GEN4_RATIOS : RUNWAY_VEO31_RATIOS;
    const durations = model === "gen4.5" || model === "gen4_turbo" ? RUNWAY_GEN4_DURATIONS : RUNWAY_VEO31_DURATIONS;
    if (!(ratios as readonly string[]).includes(runwayRatio)) {
      setRunwayRatio(ratios[0]);
    }
    if (!(durations as readonly number[]).includes(durationSeconds)) {
      setDurationSeconds(model === "veo3.1" || model === "veo3.1_fast" ? 8 : 5);
    }
  }, [model]);

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

  useEffect(() => {
    if (!preGenRefFile0) {
      setPreGenPreview0(null);
      return;
    }
    const url = URL.createObjectURL(preGenRefFile0);
    setPreGenPreview0(url);
    return () => URL.revokeObjectURL(url);
  }, [preGenRefFile0]);

  useEffect(() => {
    if (!preGenRefFile1) {
      setPreGenPreview1(null);
      return;
    }
    const url = URL.createObjectURL(preGenRefFile1);
    setPreGenPreview1(url);
    return () => URL.revokeObjectURL(url);
  }, [preGenRefFile1]);

  function refDisplayUrl(index: number): string | null {
    if (index === 0 && preview0) return preview0;
    if (index === 1 && preview1) return preview1;
    const keyOrUrl = existingRefs[index];
    if (!keyOrUrl) return null;
    if (keyOrUrl.startsWith("http://") || keyOrUrl.startsWith("https://")) return keyOrUrl;
    return `/api/templates/references/url?key=${encodeURIComponent(keyOrUrl)}`;
  }

  function preGenRefDisplayUrl(index: number): string | null {
    if (index === 0 && preGenPreview0) return preGenPreview0;
    if (index === 1 && preGenPreview1) return preGenPreview1;
    const keyOrUrl = existingPreGenRefs[index];
    if (!keyOrUrl) return null;
    if (keyOrUrl.startsWith("http://") || keyOrUrl.startsWith("https://")) return keyOrUrl;
    return `/api/templates/references/url?key=${encodeURIComponent(keyOrUrl)}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const configPayload: Record<string, unknown> = {
      prompt: prompt.trim().slice(0, 1000),
      aspectRatio,
      resolution,
      durationSeconds,
      referenceImageUrls: isRunwayImageToVideoModel(model) ? [] : (templateId ? existingRefs : []),
    };
    if (isRunwayImageToVideoModel(model)) {
      configPayload.runwayRatio = runwayRatio;
    }
    if (model === "veo3.1" || model === "veo3.1_fast") {
      configPayload.audio = runwayAudio;
    }
    if (isRunwayImageToVideoModel(model) && (preGenPrompt.trim() || existingPreGenRefs.length > 0 || preGenRefFile0 || preGenRefFile1)) {
      configPayload.preGen = {
        prompt: preGenPrompt.trim(),
        referenceImageUrls: templateId ? existingPreGenRefs : [],
      };
    }
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
      if (preGenRefFile0) formData.set("preGenRef0", preGenRefFile0);
      if (preGenRefFile1) formData.set("preGenRef1", preGenRefFile1);

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
          Prompt <span className="text-zinc-500 dark:text-zinc-400">(1–1000 characters)</span>
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={1000}
          rows={4}
          className={inputClass}
          placeholder="Describe the video you want to generate..."
        />
        {prompt.length > 0 && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{prompt.length}/1000</p>
        )}
      </div>

      {isRunwayImageToVideoModel(model) ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="runwayRatio" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Ratio
            </label>
            <select
              id="runwayRatio"
              value={runwayRatio}
              onChange={(e) => setRunwayRatio(e.target.value)}
              className={inputClass}
            >
              {runwayRatios.map((r) => (
                <option key={r} value={r}>
                  {r}
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
              {runwayDurations.map((d) => (
                <option key={d} value={d}>
                  {d} seconds
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
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
      )}

      {(model === "veo3.1" || model === "veo3.1_fast") && (
        <div className="flex items-center gap-2">
          <input
            id="runway-audio"
            type="checkbox"
            checked={runwayAudio}
            onChange={(e) => setRunwayAudio(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800"
          />
          <label htmlFor="runway-audio" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Include audio in video (default on)
          </label>
        </div>
      )}

      {isRunwayImageToVideoModel(model) && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 dark:border-zinc-700 dark:bg-zinc-800/50">
          <button
            type="button"
            onClick={() => setPreGenExpanded((e) => !e)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Pre-generation step (optional)
            <span className="text-zinc-400 dark:text-zinc-500" aria-hidden>
              {preGenExpanded ? "▼" : "▶"}
            </span>
          </button>
          {preGenExpanded && (
            <div className="space-y-3 border-t border-zinc-200 px-4 pb-4 pt-3 dark:border-zinc-700">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Generate an image from a prompt and reference images first; that image is then used as the first frame for the video. Leave empty to use the Dropbox input image directly.
              </p>
              <div>
                <label htmlFor="preGenPrompt" className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
                  Image generation prompt
                </label>
                <textarea
                  id="preGenPrompt"
                  value={preGenPrompt}
                  onChange={(e) => setPreGenPrompt(e.target.value)}
                  rows={2}
                  className={inputClass}
                  placeholder="Describe the image to generate..."
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
                    Reference image 1
                  </label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    onChange={(e) => setPreGenRefFile0(e.target.files?.[0] ?? null)}
                    className={inputClass}
                  />
                  {preGenRefDisplayUrl(0) && (
                    <img
                      src={preGenRefDisplayUrl(0)!}
                      alt="Pre-gen ref 1"
                      className="mt-2 max-h-32 rounded border border-zinc-200 object-contain dark:border-zinc-700"
                    />
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
                    Reference image 2
                  </label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    onChange={(e) => setPreGenRefFile1(e.target.files?.[0] ?? null)}
                    className={inputClass}
                  />
                  {preGenRefDisplayUrl(1) && (
                    <img
                      src={preGenRefDisplayUrl(1)!}
                      alt="Pre-gen ref 2"
                      className="mt-2 max-h-32 rounded border border-zinc-200 object-contain dark:border-zinc-700"
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {!isRunwayImageToVideoModel(model) && (
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
      )}

      <div>
        <span className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Dropbox folders
        </span>
        {!dropboxConnected ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connect Dropbox to choose a source and destination folder for this template.{" "}
            <a
              href={`/api/dropbox/auth?returnTo=${encodeURIComponent(pathname ?? "/dashboard/templates/new")}`}
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
