"use client";

import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

const DEFAULT_COLORS = ["#CADCFC", "#A0B9D1"];
const VOLUME_POLL_MS = 90;

const STATE_PRESETS = {
  idle: {
    shellScale: 0.98,
    ringOpacity: 0.28,
    glowOpacity: 0.34,
  },
  thinking: {
    shellScale: 1,
    ringOpacity: 0.34,
    glowOpacity: 0.4,
  },
  listening: {
    shellScale: 1.02,
    ringOpacity: 0.42,
    glowOpacity: 0.5,
  },
  talking: {
    shellScale: 1.08,
    ringOpacity: 0.62,
    glowOpacity: 0.7,
  },
};

/**
 * @typedef {null | "thinking" | "listening" | "talking"} AgentState
 */

export function Orb({
  colors = DEFAULT_COLORS,
  colorsRef,
  resizeDebounce = 100,
  seed,
  agentState = null,
  volumeMode = "auto",
  manualInput = 0,
  manualOutput = 0,
  inputVolumeRef,
  outputVolumeRef,
  getInputVolume,
  getOutputVolume,
  className,
  small = false,
  state,
}) {
  const [levels, setLevels] = useState({ input: 0, output: 0 });
  const resolvedAgentState = mapAgentState(agentState, state);
  const palette = useMemo(() => {
    const nextColors = colorsRef?.current || colors || DEFAULT_COLORS;
    return Array.isArray(nextColors) && nextColors.length >= 2 ? nextColors : DEFAULT_COLORS;
  }, [colors, colorsRef]);
  const preset = STATE_PRESETS[resolvedAgentState || "idle"] || STATE_PRESETS.idle;
  const motionSeed = Number.isFinite(seed) ? seed : 1247;
  const shellRotation = ((motionSeed % 17) - 8) * 0.9;
  const ringRotation = ((motionSeed % 23) - 11) * 0.6;

  useEffect(() => {
    if (volumeMode === "manual") {
      setLevels({
        input: clamp01(inputVolumeRef?.current ?? manualInput),
        output: clamp01(outputVolumeRef?.current ?? manualOutput),
      });
      return;
    }

    let cancelled = false;
    const intervalId = setInterval(() => {
      void Promise.all([
        resolveVolume(getInputVolume, inputVolumeRef?.current),
        resolveVolume(getOutputVolume, outputVolumeRef?.current),
      ]).then(([input, output]) => {
        if (cancelled) {
          return;
        }

        setLevels((current) => ({
          input: easeTowards(current.input, input, 0.36),
          output: easeTowards(current.output, output, 0.34),
        }));
      });
    }, Math.max(48, resizeDebounce || VOLUME_POLL_MS));

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [
    getInputVolume,
    getOutputVolume,
    inputVolumeRef,
    manualInput,
    manualOutput,
    outputVolumeRef,
    resizeDebounce,
    volumeMode,
  ]);

  const inputLevel = clamp01(levels.input);
  const outputLevel = clamp01(levels.output);
  const combinedLevel = Math.max(inputLevel * 0.92, outputLevel);
  const shellScale = preset.shellScale + combinedLevel * 0.1;
  const coreScale = 0.88 + combinedLevel * 0.22;
  const haloScale = 0.96 + combinedLevel * 0.34;
  const shellOpacity = 0.86 + combinedLevel * 0.14;
  const ringOpacity = preset.ringOpacity + combinedLevel * 0.22;
  const glowOpacity = preset.glowOpacity + combinedLevel * 0.18;

  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-full border border-white/90 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.96),rgba(241,251,248,0.92)_48%,rgba(248,238,248,0.9)_100%)] shadow-[0_24px_80px_rgba(0,127,112,0.18)]",
        small ? "size-20" : "size-28",
        className
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(255,255,255,0.9),transparent_36%),radial-gradient(circle_at_80%_76%,rgba(255,255,255,0.24),transparent_28%)]" />

      <div
        className="absolute inset-2 rounded-full border border-white/35 bg-white/18 backdrop-blur-[2px] animate-[orbFloat_8s_ease-in-out_infinite]"
        style={{
          animationDelay: `${(motionSeed % 7) * -0.22}s`,
        }}
      />

      <div
        className="absolute inset-[11%] rounded-[42%] blur-[1px] animate-[orbOrbital_7.2s_ease-in-out_infinite]"
        style={{
          backgroundImage: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`,
          opacity: shellOpacity,
          transform: `scale(${shellScale}) rotate(${shellRotation}deg)`,
          animationDelay: `${(motionSeed % 5) * -0.35}s`,
        }}
      />

      <div
        className="absolute inset-[16%] rounded-[46%] border border-white/45 animate-[orbHaloSpin_10s_linear_infinite]"
        style={{
          opacity: ringOpacity,
          transform: `scale(${haloScale}) rotate(${ringRotation}deg)`,
          animationDelay: `${(motionSeed % 9) * -0.2}s`,
        }}
      />

      <div
        className="absolute inset-[22%] rounded-[44%] blur-[2px] animate-[orbCoreBreath_4.6s_ease-in-out_infinite]"
        style={{
          backgroundImage: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.68), ${withAlpha(
            palette[0],
            0.22
          )} 45%, ${withAlpha(palette[1], 0.16)} 72%, transparent 100%)`,
          transform: `scale(${coreScale})`,
          opacity: glowOpacity,
          animationDelay: `${(motionSeed % 11) * -0.18}s`,
        }}
      />

      <div
        className="absolute inset-[26%] rounded-full blur-2xl"
        style={{
          background: `radial-gradient(circle, rgba(255,255,255,0.48), ${withAlpha(
            palette[1],
            0.08
          )} 58%, transparent 100%)`,
          opacity: 0.64 + combinedLevel * 0.16,
        }}
      />

      <div className="absolute inset-[12%] rounded-full border border-white/50" />
      <div
        className="absolute inset-[30%] rounded-full blur-xl"
        style={{
          background: `radial-gradient(circle, rgba(255,255,255,0.55), ${withAlpha(
            palette[0],
            0.1
          )} 62%, transparent 100%)`,
          opacity: 0.52 + combinedLevel * 0.12,
        }}
      />
    </div>
  );
}

function mapAgentState(agentState, legacyState) {
  if (agentState) {
    return agentState;
  }

  if (legacyState === "listening") {
    return "listening";
  }

  if (legacyState === "agent-talking" || legacyState === "user-talking" || legacyState === "talking") {
    return "talking";
  }

  return null;
}

async function resolveVolume(getVolume, fallbackValue) {
  if (typeof getVolume === "function") {
    try {
      const value = await getVolume();
      return clamp01(value);
    } catch {
      return clamp01(fallbackValue);
    }
  }

  return clamp01(fallbackValue);
}

function easeTowards(current, target, factor) {
  return current + (target - current) * factor;
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(1, number));
}

function withAlpha(hex, alpha) {
  const safeHex = String(hex || "").replace("#", "");
  if (safeHex.length !== 6) {
    return hex;
  }

  const red = parseInt(safeHex.slice(0, 2), 16);
  const green = parseInt(safeHex.slice(2, 4), 16);
  const blue = parseInt(safeHex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
