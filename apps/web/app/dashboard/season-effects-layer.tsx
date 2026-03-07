"use client";

import { useCallback, useEffect, useRef } from "react";
import { Emitter, type EmitterConfigV3 } from "@pixi/particle-emitter";
import { Application, Assets, Container, type Texture } from "pixi.js";

export type SeasonEffectPreset = "SNOW" | "RAIN" | "BLOSSOM" | "MAPLE" | "BREEZE";

interface SeasonEffectsLayerProps {
  enabled: boolean;
  preset: SeasonEffectPreset;
  reducedDensity?: boolean;
}

interface EffectTextures {
  snow: Texture;
  rain: Texture;
  blossom: Texture;
  maple: Texture;
}

type Size = { width: number; height: number };

const RESOLUTION_CAP = 2;
const DEFAULT_SIZE: Size = { width: 1440, height: 900 };

const TEXTURE_PATHS = {
  snow: "/effects/snowflake.svg",
  rain: "/effects/raindrop.svg",
  blossom: "/effects/blossom-petal.svg",
  maple: "/effects/maple-leaf.svg",
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function makeSize(host: HTMLDivElement | null): Size {
  if (!host) return DEFAULT_SIZE;
  const width = host.clientWidth || window.innerWidth || DEFAULT_SIZE.width;
  const height = host.clientHeight || window.innerHeight || DEFAULT_SIZE.height;
  return { width, height };
}

function scaleDensity(reducedDensity: boolean): number {
  return reducedDensity ? 0.6 : 1;
}

function makeAlphaList(mid: number): { list: Array<{ value: number; time: number }> } {
  return {
    list: [
      { value: 0, time: 0 },
      { value: mid, time: 0.1 },
      { value: mid, time: 0.82 },
      { value: 0, time: 1 },
    ],
  };
}

function makeRectSpawn(width: number, height: number, topOffset: number): { type: "rect"; data: { x: number; y: number; w: number; h: number } } {
  return {
    type: "rect",
    data: {
      x: -Math.round(width * 0.08),
      y: -Math.round(topOffset),
      w: Math.round(width * 1.16),
      h: Math.round(height * 0.12),
    },
  };
}

function makeSnowEmitters(textures: EffectTextures, size: Size, reducedDensity: boolean): EmitterConfigV3[] {
  const density = scaleDensity(reducedDensity);
  const baseMax = Math.round(clamp(size.width / 14, 80, 220) * density);
  const spawn = makeRectSpawn(size.width, size.height, 80);

  return [
    {
      lifetime: { min: 8, max: 14 },
      frequency: 0.038,
      particlesPerWave: 1,
      emitterLifetime: -1,
      maxParticles: baseMax,
      addAtBack: true,
      pos: { x: 0, y: 0 },
      behaviors: [
        { type: "alpha", config: { alpha: makeAlphaList(0.78) } },
        { type: "scaleStatic", config: { min: 0.11, max: 0.2 } },
        { type: "moveSpeedStatic", config: { min: 18, max: 35 } },
        { type: "rotationStatic", config: { min: 0, max: 360 } },
        { type: "rotation", config: { minStart: 0, maxStart: 360, minSpeed: -14, maxSpeed: 14, accel: 0 } },
        { type: "spawnShape", config: spawn },
        { type: "textureSingle", config: { texture: textures.snow } },
      ],
    },
    {
      lifetime: { min: 10, max: 17 },
      frequency: 0.055,
      particlesPerWave: 1,
      emitterLifetime: -1,
      maxParticles: Math.round(baseMax * 0.72),
      addAtBack: true,
      pos: { x: 0, y: 0 },
      behaviors: [
        { type: "alpha", config: { alpha: makeAlphaList(0.58) } },
        { type: "scaleStatic", config: { min: 0.06, max: 0.13 } },
        { type: "moveSpeedStatic", config: { min: 10, max: 24 } },
        { type: "rotationStatic", config: { min: 0, max: 360 } },
        { type: "rotation", config: { minStart: 0, maxStart: 360, minSpeed: -8, maxSpeed: 8, accel: 0 } },
        { type: "spawnShape", config: spawn },
        { type: "textureSingle", config: { texture: textures.snow } },
      ],
    },
  ];
}

function makeRainEmitters(textures: EffectTextures, size: Size, reducedDensity: boolean): EmitterConfigV3[] {
  const density = scaleDensity(reducedDensity);
  const baseMax = Math.round(clamp(size.width / 9.5, 120, 300) * density);
  const spawn = makeRectSpawn(size.width, size.height, 120);

  return [
    {
      lifetime: { min: 0.72, max: 1.25 },
      frequency: 0.009,
      particlesPerWave: 3,
      emitterLifetime: -1,
      maxParticles: baseMax,
      addAtBack: true,
      pos: { x: 0, y: 0 },
      behaviors: [
        { type: "alpha", config: { alpha: makeAlphaList(0.82) } },
        { type: "scaleStatic", config: { min: 0.08, max: 0.14 } },
        { type: "rotationStatic", config: { min: 112, max: 118 } },
        { type: "moveAcceleration", config: { minStart: 1080, maxStart: 1460, accel: { x: 0, y: 1700 }, rotate: true, maxSpeed: 2400 } },
        { type: "spawnShape", config: spawn },
        { type: "textureSingle", config: { texture: textures.rain } },
      ],
    },
    {
      lifetime: { min: 1.05, max: 1.8 },
      frequency: 0.015,
      particlesPerWave: 2,
      emitterLifetime: -1,
      maxParticles: Math.round(baseMax * 0.68),
      addAtBack: true,
      pos: { x: 0, y: 0 },
      behaviors: [
        { type: "alpha", config: { alpha: makeAlphaList(0.56) } },
        { type: "scaleStatic", config: { min: 0.05, max: 0.09 } },
        { type: "rotationStatic", config: { min: 112, max: 118 } },
        { type: "moveAcceleration", config: { minStart: 780, maxStart: 1020, accel: { x: 0, y: 1300 }, rotate: true, maxSpeed: 1800 } },
        { type: "spawnShape", config: spawn },
        { type: "textureSingle", config: { texture: textures.rain } },
      ],
    },
  ];
}

function makeBlossomEmitters(textures: EffectTextures, size: Size, reducedDensity: boolean): EmitterConfigV3[] {
  const density = scaleDensity(reducedDensity);
  const baseMax = Math.round(clamp(size.width / 18, 70, 180) * density);
  const spawn = makeRectSpawn(size.width, size.height, 70);

  return [
    {
      lifetime: { min: 9, max: 14 },
      frequency: 0.041,
      particlesPerWave: 1,
      emitterLifetime: -1,
      maxParticles: baseMax,
      addAtBack: true,
      pos: { x: 0, y: 0 },
      behaviors: [
        { type: "alpha", config: { alpha: makeAlphaList(0.86) } },
        { type: "scaleStatic", config: { min: 0.12, max: 0.22 } },
        { type: "rotation", config: { minStart: 22, maxStart: 170, minSpeed: -36, maxSpeed: 28, accel: 0 } },
        { type: "moveAcceleration", config: { minStart: 60, maxStart: 125, accel: { x: -58, y: 148 }, rotate: false, maxSpeed: 220 } },
        { type: "spawnShape", config: spawn },
        { type: "textureSingle", config: { texture: textures.blossom } },
      ],
    },
    {
      lifetime: { min: 11, max: 17 },
      frequency: 0.057,
      particlesPerWave: 1,
      emitterLifetime: -1,
      maxParticles: Math.round(baseMax * 0.7),
      addAtBack: true,
      pos: { x: 0, y: 0 },
      behaviors: [
        { type: "alpha", config: { alpha: makeAlphaList(0.64) } },
        { type: "scaleStatic", config: { min: 0.07, max: 0.13 } },
        { type: "rotation", config: { minStart: 12, maxStart: 160, minSpeed: -22, maxSpeed: 18, accel: 0 } },
        { type: "moveAcceleration", config: { minStart: 38, maxStart: 85, accel: { x: -36, y: 118 }, rotate: false, maxSpeed: 160 } },
        { type: "spawnShape", config: spawn },
        { type: "textureSingle", config: { texture: textures.blossom } },
      ],
    },
  ];
}

function makeMapleEmitters(textures: EffectTextures, size: Size, reducedDensity: boolean): EmitterConfigV3[] {
  const density = scaleDensity(reducedDensity);
  const baseMax = Math.round(clamp(size.width / 19, 64, 162) * density);
  const spawn = makeRectSpawn(size.width, size.height, 70);

  return [
    {
      lifetime: { min: 8, max: 13 },
      frequency: 0.044,
      particlesPerWave: 1,
      emitterLifetime: -1,
      maxParticles: baseMax,
      addAtBack: true,
      pos: { x: 0, y: 0 },
      behaviors: [
        { type: "alpha", config: { alpha: makeAlphaList(0.9) } },
        { type: "scaleStatic", config: { min: 0.12, max: 0.24 } },
        { type: "rotation", config: { minStart: -30, maxStart: 150, minSpeed: -42, maxSpeed: 34, accel: 0 } },
        { type: "moveAcceleration", config: { minStart: 72, maxStart: 146, accel: { x: 48, y: 182 }, rotate: false, maxSpeed: 240 } },
        { type: "spawnShape", config: spawn },
        { type: "textureSingle", config: { texture: textures.maple } },
      ],
    },
    {
      lifetime: { min: 10, max: 15 },
      frequency: 0.061,
      particlesPerWave: 1,
      emitterLifetime: -1,
      maxParticles: Math.round(baseMax * 0.72),
      addAtBack: true,
      pos: { x: 0, y: 0 },
      behaviors: [
        { type: "alpha", config: { alpha: makeAlphaList(0.66) } },
        { type: "scaleStatic", config: { min: 0.07, max: 0.13 } },
        { type: "rotation", config: { minStart: -15, maxStart: 135, minSpeed: -28, maxSpeed: 24, accel: 0 } },
        { type: "moveAcceleration", config: { minStart: 40, maxStart: 92, accel: { x: 34, y: 128 }, rotate: false, maxSpeed: 170 } },
        { type: "spawnShape", config: spawn },
        { type: "textureSingle", config: { texture: textures.maple } },
      ],
    },
  ];
}

function makeBreezeEmitters(size: Size, reducedDensity: boolean): EmitterConfigV3[] {
  const density = scaleDensity(reducedDensity);
  const baseMax = Math.round(clamp(size.width / 18, 60, 165) * density);
  const spawn = makeRectSpawn(size.width, size.height, 40);

  return [
    {
      lifetime: { min: 14, max: 22 },
      frequency: 0.045,
      particlesPerWave: 1,
      emitterLifetime: -1,
      maxParticles: baseMax,
      addAtBack: true,
      pos: { x: 0, y: 0 },
      behaviors: [
        { type: "alpha", config: { alpha: makeAlphaList(0.32) } },
        { type: "scaleStatic", config: { min: 0.05, max: 0.12 } },
        { type: "colorStatic", config: { color: "dbeafe" } },
        { type: "moveAcceleration", config: { minStart: 20, maxStart: 58, accel: { x: 8, y: 24 }, rotate: false, maxSpeed: 90 } },
        { type: "spawnShape", config: spawn },
      ],
    },
  ];
}

function buildConfigs(preset: SeasonEffectPreset, textures: EffectTextures, size: Size, reducedDensity: boolean): EmitterConfigV3[] {
  if (preset === "SNOW") return makeSnowEmitters(textures, size, reducedDensity);
  if (preset === "RAIN") return makeRainEmitters(textures, size, reducedDensity);
  if (preset === "BLOSSOM") return makeBlossomEmitters(textures, size, reducedDensity);
  if (preset === "MAPLE") return makeMapleEmitters(textures, size, reducedDensity);
  return makeBreezeEmitters(size, reducedDensity);
}

export function SeasonEffectsLayer({ enabled, preset, reducedDensity = false }: SeasonEffectsLayerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const layerRef = useRef<Container | null>(null);
  const emittersRef = useRef<Emitter[]>([]);
  const texturesRef = useRef<EffectTextures | null>(null);
  const rafResizeRef = useRef<number | null>(null);

  const clearEmitters = useCallback(() => {
    for (const emitter of emittersRef.current) {
      emitter.emit = false;
      emitter.destroy();
    }
    emittersRef.current = [];
  }, []);

  const ensureTextures = useCallback(async (): Promise<EffectTextures> => {
    if (texturesRef.current) return texturesRef.current;

    const loaded = await Assets.load([
      TEXTURE_PATHS.snow,
      TEXTURE_PATHS.rain,
      TEXTURE_PATHS.blossom,
      TEXTURE_PATHS.maple,
    ]);

    const textures: EffectTextures = {
      snow: loaded[TEXTURE_PATHS.snow] as Texture,
      rain: loaded[TEXTURE_PATHS.rain] as Texture,
      blossom: loaded[TEXTURE_PATHS.blossom] as Texture,
      maple: loaded[TEXTURE_PATHS.maple] as Texture,
    };

    texturesRef.current = textures;
    return textures;
  }, []);

  const rebuildEmitters = useCallback(async () => {
    const app = appRef.current;
    const layer = layerRef.current;
    const host = hostRef.current;
    if (!app || !layer || !host || !enabled) {
      clearEmitters();
      return;
    }

    const size = makeSize(host);
    const textures = await ensureTextures();
    const configs = buildConfigs(preset, textures, size, reducedDensity);

    clearEmitters();
    emittersRef.current = configs.map((config) => {
      const emitter = new Emitter(layer, config);
      emitter.emit = true;
      return emitter;
    });
  }, [clearEmitters, enabled, ensureTextures, preset, reducedDensity]);

  useEffect(() => {
    if (!enabled) {
      clearEmitters();
      if (appRef.current) {
        appRef.current.stage.visible = false;
      }
      return;
    }

    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;

    const setup = async () => {
      if (!appRef.current) {
        const app = new Application({
          resizeTo: host,
          antialias: true,
          autoDensity: true,
          backgroundAlpha: 0,
          resolution: Math.min(window.devicePixelRatio || 1, RESOLUTION_CAP),
        });

        const view = app.view as HTMLCanvasElement;
        view.classList.add("season-effects-canvas");
        host.appendChild(view);

        const layer = new Container();
        layer.eventMode = "none";
        app.stage.eventMode = "none";
        app.stage.addChild(layer);

        app.ticker.add(() => {
          const deltaSeconds = app.ticker.deltaMS / 1000;
          for (const emitter of emittersRef.current) {
            emitter.update(deltaSeconds);
          }
        });

        appRef.current = app;
        layerRef.current = layer;
      }

      if (cancelled) return;
      if (appRef.current) {
        appRef.current.stage.visible = true;
      }
      await rebuildEmitters();
    };

    void setup();

    return () => {
      cancelled = true;
    };
  }, [clearEmitters, enabled, rebuildEmitters]);

  useEffect(() => {
    if (!enabled || !hostRef.current) return;

    const onResize = () => {
      if (rafResizeRef.current) {
        window.cancelAnimationFrame(rafResizeRef.current);
      }
      rafResizeRef.current = window.requestAnimationFrame(() => {
        void rebuildEmitters();
      });
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (rafResizeRef.current) {
        window.cancelAnimationFrame(rafResizeRef.current);
        rafResizeRef.current = null;
      }
    };
  }, [enabled, rebuildEmitters]);

  useEffect(() => {
    return () => {
      clearEmitters();
      if (appRef.current) {
        appRef.current.destroy(true);
        appRef.current = null;
      }
      layerRef.current = null;
      texturesRef.current = null;
    };
  }, [clearEmitters]);

  return (
    <div className={`season-effects-layer season-effects-${preset.toLowerCase()}`} aria-hidden="true">
      <div className="season-effects-atmosphere" />
      <div ref={hostRef} className="season-effects-render-host" />
    </div>
  );
}
