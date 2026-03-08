"use client";

import { useState, useMemo } from "react";
import {
  computeJobCost,
  CREDIT_MULTIPLIER,
  API_CREDITS_PER_PREGEN_IMAGE,
} from "@/lib/credits";
import {
  VIDEO_MODELS,
  RUNWAY_GEN4_DURATIONS,
  RUNWAY_VEO31_DURATIONS,
} from "@/lib/video-models";

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-zinc-900 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-400";

function formatCredits(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

export function PricingCalculator() {
  const [calcModel, setCalcModel] = useState("veo3.1_fast");
  const [calcDuration, setCalcDuration] = useState(6);
  const [calcAudio, setCalcAudio] = useState(true);
  const [calcPreGen, setCalcPreGen] = useState(false);

  const isVeo = calcModel === "veo3.1" || calcModel === "veo3.1_fast";
  const durations: number[] = isVeo
    ? [...RUNWAY_VEO31_DURATIONS]
    : [...RUNWAY_GEN4_DURATIONS];
  const safeDuration = durations.includes(calcDuration)
    ? calcDuration
    : durations[0];

  const calcResult = useMemo(() => {
    return computeJobCost({
      model: calcModel,
      durationSeconds: safeDuration,
      audio: calcAudio,
      hasPreGen: calcPreGen,
    });
  }, [calcModel, safeDuration, calcAudio, calcPreGen]);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
      <h3 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Estimate cost per video
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label
            htmlFor="home-calc-model"
            className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400"
          >
            Model
          </label>
          <select
            id="home-calc-model"
            value={calcModel}
            onChange={(e) => {
              const nextModel = e.target.value;
              setCalcModel(nextModel);
              const nextIsVeo =
                nextModel === "veo3.1" || nextModel === "veo3.1_fast";
              const nextDurations = nextIsVeo
                ? RUNWAY_VEO31_DURATIONS
                : RUNWAY_GEN4_DURATIONS;
              const valid = (nextDurations as readonly number[]).includes(
                calcDuration
              );
              if (!valid) setCalcDuration(nextDurations[0]);
            }}
            className={inputClass}
          >
            {VIDEO_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="home-calc-duration"
            className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400"
          >
            Duration
          </label>
          <select
            id="home-calc-duration"
            value={safeDuration}
            onChange={(e) => setCalcDuration(Number(e.target.value))}
            className={inputClass}
          >
            {(isVeo ? RUNWAY_VEO31_DURATIONS : RUNWAY_GEN4_DURATIONS).map(
              (d) => (
                <option key={d} value={d}>
                  {d} seconds
                </option>
              )
            )}
          </select>
        </div>
        <div className="flex flex-col justify-end">
          {isVeo && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={calcAudio}
                onChange={(e) => setCalcAudio(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800"
              />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                With audio
              </span>
            </label>
          )}
        </div>
        <div className="flex flex-col justify-end">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={calcPreGen}
              onChange={(e) => setCalcPreGen(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500 dark:border-zinc-600 dark:bg-zinc-800"
            />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              Pre-gen image
            </span>
          </label>
        </div>
      </div>
      <div className="mt-6 rounded-xl bg-zinc-100 p-4 dark:bg-zinc-800">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Estimated cost
        </p>
        <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          {formatCredits(calcResult.creditCost)} credits
        </p>
      </div>
      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        Credits are charged per video. 100 credits = $1. Pre-gen adds{" "}
        {formatCredits(API_CREDITS_PER_PREGEN_IMAGE * CREDIT_MULTIPLIER)}{" "}
        credits per image.
      </p>
    </div>
  );
}
