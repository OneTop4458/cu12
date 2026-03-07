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

const SNOW_IMAGE = {
  src: "/effects/snowflake.svg",
  width: 64,
  height: 64,
  name: "snowflake",
  replaceColor: false,
  gif: false,
};

const RAIN_IMAGE = {
  src: "/effects/raindrop.svg",
  width: 48,
  height: 128,
  name: "raindrop",
  replaceColor: false,
  gif: false,
};

const BLOSSOM_IMAGE = {
  src: "/effects/blossom-petal.svg",
  width: 88,
  height: 72,
  name: "blossom-petal",
  replaceColor: false,
  gif: false,
};

const MAPLE_IMAGE = {
  src: "/effects/maple-leaf.svg",
  width: 88,
  height: 88,
  name: "maple-leaf",
  replaceColor: false,
  gif: false,
};

function buildPresetOptions(preset: SeasonEffectPreset, reducedDensity: boolean): ISourceOptions {
  const baseCount = reducedDensity ? 22 : 52;
  const base: ISourceOptions = {
    fullScreen: {
      enable: false,
    },
    fpsLimit: 90,
    detectRetina: false,
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
        speed: {
          min: 0.55,
          max: 1.25,
        },
        straight: false,
        random: false,
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
        number: {
          value: reducedDensity ? 14 : 30,
          density: {
            enable: true,
            width: 1000,
            height: 1200,
          },
        },
        opacity: { value: { min: 0.52, max: 0.94 } },
        size: { value: { min: 10, max: 22 } },
        shape: {
          type: "image",
          options: {
            image: [SNOW_IMAGE],
          },
        },
        move: {
          ...base.particles?.move,
          direction: "bottom",
          speed: {
            min: reducedDensity ? 0.45 : 0.65,
            max: reducedDensity ? 1.15 : 1.75,
          },
          drift: reducedDensity ? 0.35 : 0.55,
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
          value: reducedDensity ? 18 : 40,
          density: {
            enable: true,
            width: 1000,
            height: 1000,
          },
        },
        opacity: { value: { min: 0.42, max: 0.78 } },
        size: { value: { min: 9, max: 18 } },
        shape: {
          type: "image",
          options: {
            image: [RAIN_IMAGE],
          },
        },
        move: {
          ...base.particles?.move,
          direction: "bottom-right",
          speed: {
            min: reducedDensity ? 9.5 : 12,
            max: reducedDensity ? 14.5 : 21,
          },
          straight: true,
          random: true,
        },
      },
    };
  }

  if (preset === "BLOSSOM") {
    return {
      ...base,
      particles: {
        ...base.particles,
        number: {
          value: reducedDensity ? 14 : 30,
          density: {
            enable: true,
            width: 1200,
            height: 1200,
          },
        },
        opacity: { value: { min: 0.5, max: 0.9 } },
        size: { value: { min: 11, max: 22 } },
        shape: {
          type: "image",
          options: {
            image: [BLOSSOM_IMAGE],
          },
        },
        rotate: {
          value: { min: 0, max: 360 },
          direction: "random",
          animation: {
            enable: true,
            speed: reducedDensity ? 7 : 13,
          },
        },
        move: {
          ...base.particles?.move,
          direction: "bottom-left",
          speed: {
            min: reducedDensity ? 0.85 : 1.1,
            max: reducedDensity ? 1.65 : 2.2,
          },
          drift: reducedDensity ? -0.45 : -0.75,
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
        number: {
          value: reducedDensity ? 14 : 28,
          density: {
            enable: true,
            width: 1200,
            height: 1200,
          },
        },
        opacity: { value: { min: 0.5, max: 0.92 } },
        size: { value: { min: 12, max: 24 } },
        shape: {
          type: "image",
          options: {
            image: [MAPLE_IMAGE],
          },
        },
        rotate: {
          value: { min: 0, max: 360 },
          direction: "random",
          animation: {
            enable: true,
            speed: reducedDensity ? 6 : 11,
          },
        },
        move: {
          ...base.particles?.move,
          direction: "bottom-right",
          speed: {
            min: reducedDensity ? 0.75 : 1.05,
            max: reducedDensity ? 1.55 : 2.1,
          },
          drift: reducedDensity ? 0.5 : 0.85,
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
        value: reducedDensity ? 12 : 26,
        density: {
          enable: true,
          width: 1400,
          height: 1400,
        },
      },
      color: { value: ["#7dd3fc", "#bfdbfe", "#e2e8f0", "#93c5fd"] },
      opacity: { value: { min: 0.2, max: 0.48 } },
      size: { value: { min: 1.2, max: 2.6 } },
      shape: { type: "circle" },
      move: {
        ...base.particles?.move,
        direction: "none",
        speed: {
          min: reducedDensity ? 0.35 : 0.55,
          max: reducedDensity ? 0.85 : 1.25,
        },
        drift: reducedDensity ? 0.15 : 0.3,
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
