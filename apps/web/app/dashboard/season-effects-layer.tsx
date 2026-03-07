"use client";

import { useEffect, useMemo, useState } from "react";
import Particles, { initParticlesEngine } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";
import type { Engine, ISourceOptions } from "@tsparticles/engine";

export type SeasonEffectPreset = "SNOW" | "RAIN" | "BLOSSOM" | "MAPLE" | "BREEZE";

interface SeasonEffectsLayerProps {
  enabled: boolean;
  preset: SeasonEffectPreset;
  reducedDensity?: boolean;
}

let particlesEngineReady = false;

function buildPresetOptions(preset: SeasonEffectPreset, reducedDensity: boolean): ISourceOptions {
  const baseCount = reducedDensity ? 36 : 72;
  const base: ISourceOptions = {
    fullScreen: {
      enable: false,
    },
    fpsLimit: 60,
    detectRetina: true,
    pauseOnBlur: true,
    particles: {
      number: {
        value: baseCount,
        density: {
          enable: true,
          width: 1200,
          height: 1200,
        },
      },
      collisions: {
        enable: false,
      },
      move: {
        enable: true,
        outModes: {
          default: "out",
        },
      },
    },
    interactivity: {
      events: {
        resize: {
          enable: true,
          delay: 0.2,
        },
      },
    },
  };

  if (preset === "SNOW") {
    return {
      ...base,
      particles: {
        ...base.particles,
        color: { value: ["#ffffff", "#dbeafe"] },
        opacity: { value: { min: 0.5, max: 0.95 } },
        size: { value: { min: 2.4, max: 6.4 } },
        shape: { type: "circle" },
        move: {
          ...base.particles?.move,
          direction: "bottom",
          speed: reducedDensity ? 1.2 : 1.9,
          straight: false,
          random: true,
        },
      },
    };
  }

  if (preset === "RAIN") {
    return {
      ...base,
      particles: {
        ...base.particles,
        number: {
          value: reducedDensity ? 34 : 70,
          density: {
            enable: true,
            width: 1000,
            height: 1000,
          },
        },
        color: { value: ["#93c5fd", "#60a5fa"] },
        opacity: { value: { min: 0.28, max: 0.6 } },
        size: { value: { min: 2.2, max: 3.4 } },
        shape: { type: "circle" },
        move: {
          ...base.particles?.move,
          direction: "bottom-right",
          speed: reducedDensity ? 9 : 14,
          straight: true,
        },
      },
    };
  }

  if (preset === "BLOSSOM") {
    return {
      ...base,
      particles: {
        ...base.particles,
        color: { value: ["#f9a8d4", "#fbcfe8", "#fda4af"] },
        opacity: { value: { min: 0.45, max: 0.82 } },
        size: { value: { min: 3.5, max: 8.2 } },
        shape: { type: "circle" },
        rotate: {
          value: { min: 0, max: 360 },
          direction: "random",
          animation: {
            enable: true,
            speed: reducedDensity ? 12 : 20,
          },
        },
        move: {
          ...base.particles?.move,
          direction: "bottom-left",
          speed: reducedDensity ? 1.9 : 2.9,
          straight: false,
          random: true,
        },
      },
    };
  }

  if (preset === "MAPLE") {
    return {
      ...base,
      particles: {
        ...base.particles,
        color: { value: ["#fb923c", "#fdba74", "#f59e0b", "#b45309"] },
        opacity: { value: { min: 0.45, max: 0.86 } },
        size: { value: { min: 3.2, max: 7.8 } },
        shape: { type: "circle" },
        rotate: {
          value: { min: 0, max: 360 },
          direction: "random",
          animation: {
            enable: true,
            speed: reducedDensity ? 11 : 18,
          },
        },
        move: {
          ...base.particles?.move,
          direction: "bottom-right",
          speed: reducedDensity ? 1.7 : 2.7,
          straight: false,
          random: true,
        },
      },
    };
  }

  return {
    ...base,
    particles: {
      ...base.particles,
      number: {
        value: reducedDensity ? 18 : 34,
        density: {
          enable: true,
          width: 1400,
          height: 1400,
        },
      },
      color: { value: ["#dbeafe", "#bfdbfe", "#e2e8f0"] },
      opacity: { value: { min: 0.18, max: 0.36 } },
      size: { value: { min: 1.4, max: 2.8 } },
      shape: { type: "circle" },
      move: {
        ...base.particles?.move,
        direction: "none",
        speed: reducedDensity ? 0.7 : 1.1,
        straight: false,
      },
    },
  };
}

export function SeasonEffectsLayer({ enabled, preset, reducedDensity = false }: SeasonEffectsLayerProps) {
  const [isReady, setIsReady] = useState(particlesEngineReady);

  useEffect(() => {
    if (particlesEngineReady) return;
    let mounted = true;
    void initParticlesEngine(async (engine) => {
      // NOTE:
      // On some production bundles, @tsparticles/react can pass undefined here.
      // Fall back to the global engine exposed by @tsparticles/engine to keep effects working.
      const globalEngine = typeof window !== "undefined"
        ? (window as Window & { tsParticles?: Engine }).tsParticles
        : undefined;
      const safeEngine = engine ?? globalEngine;
      if (!safeEngine) {
        throw new Error("tsParticles engine is unavailable");
      }
      await loadSlim(safeEngine);
    }).then(() => {
      particlesEngineReady = true;
      if (mounted) setIsReady(true);
    }).catch((error) => {
      console.error("Season effects engine init failed", error);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const options = useMemo(
    () => buildPresetOptions(preset, reducedDensity),
    [preset, reducedDensity],
  );

  if (!enabled || !isReady) return null;

  return (
    <div className={`season-effects-layer season-effects-${preset.toLowerCase()}`} aria-hidden="true">
      <div className="season-effects-atmosphere" />
      <Particles
        id="dashboard-season-effects-layer"
        className="season-effects-particles"
        options={options}
      />
    </div>
  );
}
