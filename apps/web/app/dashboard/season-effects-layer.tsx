"use client";

import { useEffect, useMemo, useState } from "react";
import Particles, { initParticlesEngine } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";
import type { ISourceOptions } from "@tsparticles/engine";

export type SeasonEffectPreset = "SNOW" | "RAIN" | "BLOSSOM" | "MAPLE" | "BREEZE";

interface SeasonEffectsLayerProps {
  enabled: boolean;
  preset: SeasonEffectPreset;
  reducedDensity?: boolean;
}

let particlesEngineReady = false;

function buildPresetOptions(preset: SeasonEffectPreset, reducedDensity: boolean): ISourceOptions {
  const baseCount = reducedDensity ? 22 : 44;
  const base: ISourceOptions = {
    background: {
      color: {
        value: "transparent",
      },
    },
    fullScreen: {
      enable: true,
      zIndex: 30,
    },
    fpsLimit: 40,
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
        outModes: {
          default: "out",
        },
      },
    },
    interactivity: {
      events: {
        resize: {
          enable: true,
          delay: 0.4,
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
        opacity: { value: { min: 0.45, max: 0.95 } },
        size: { value: { min: 1.8, max: 5.2 } },
        shape: { type: "circle" },
        move: {
          ...base.particles?.move,
          direction: "bottom",
          speed: reducedDensity ? 1.1 : 1.7,
          straight: false,
          angle: {
            value: 20,
            offset: 0,
          },
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
          value: reducedDensity ? 24 : 52,
          density: {
            enable: true,
            width: 1000,
            height: 1000,
          },
        },
        color: { value: ["#93c5fd", "#bfdbfe"] },
        opacity: { value: { min: 0.22, max: 0.55 } },
        size: { value: { min: 8, max: 18 } },
        shape: { type: "line" },
        move: {
          ...base.particles?.move,
          direction: "bottom-right",
          speed: reducedDensity ? 8 : 12,
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
        opacity: { value: { min: 0.35, max: 0.75 } },
        size: { value: { min: 2.5, max: 6.5 } },
        shape: { type: "circle" },
        rotate: {
          value: { min: 0, max: 360 },
          direction: "random",
          animation: {
            enable: true,
            speed: reducedDensity ? 10 : 18,
          },
        },
        move: {
          ...base.particles?.move,
          direction: "bottom-left",
          speed: reducedDensity ? 1.5 : 2.2,
          straight: false,
          angle: {
            value: 16,
            offset: 0,
          },
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
        opacity: { value: { min: 0.35, max: 0.78 } },
        size: { value: { min: 2.2, max: 5.8 } },
        shape: { type: "polygon" },
        rotate: {
          value: { min: 0, max: 360 },
          direction: "random",
          animation: {
            enable: true,
            speed: reducedDensity ? 8 : 14,
          },
        },
        move: {
          ...base.particles?.move,
          direction: "bottom-right",
          speed: reducedDensity ? 1.3 : 2.1,
          straight: false,
          angle: {
            value: 24,
            offset: 0,
          },
        },
      },
    };
  }

  return {
    ...base,
    particles: {
      ...base.particles,
      number: {
        value: reducedDensity ? 12 : 22,
        density: {
          enable: true,
          width: 1400,
          height: 1400,
        },
      },
      color: { value: ["#dbeafe", "#bfdbfe", "#e2e8f0"] },
      opacity: { value: { min: 0.12, max: 0.28 } },
      size: { value: { min: 1, max: 2.4 } },
      shape: { type: "circle" },
      move: {
        ...base.particles?.move,
        direction: "none",
        speed: reducedDensity ? 0.45 : 0.75,
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
      await loadSlim(engine);
    }).then(() => {
      particlesEngineReady = true;
      if (mounted) setIsReady(true);
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
    <Particles
      id="dashboard-season-effects-layer"
      className="season-effects-layer"
      options={options}
    />
  );
}
