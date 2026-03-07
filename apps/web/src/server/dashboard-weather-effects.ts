type WeatherSeason = "SPRING" | "SUMMER" | "AUTUMN" | "WINTER";
type WeatherCondition = "SNOW" | "RAIN" | "CLEAR_OR_CLOUD";
type WeatherEffectPreset = "SNOW" | "RAIN" | "BLOSSOM" | "MAPLE" | "BREEZE";

type WeatherApiPayload = {
  current?: {
    time?: string;
    is_day?: number;
    weather_code?: number;
    temperature_2m?: number;
  };
};

export interface DashboardWeatherEffectsPayload {
  location: {
    name: string;
    latitude: number;
    longitude: number;
    timezone: string;
  };
  weather: {
    observedAt: string | null;
    weatherCode: number | null;
    isDay: boolean | null;
    temperatureC: number | null;
  };
  derived: {
    season: WeatherSeason;
    condition: WeatherCondition;
    effectPreset: WeatherEffectPreset;
  };
  fallback: boolean;
}

const LOCATION = {
  name: "Seongnam-si, Gyeonggi-do",
  latitude: 37.4201,
  longitude: 127.1262,
  timezone: "Asia/Seoul",
} as const;

const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

let cacheEntry: { expiresAt: number; value: DashboardWeatherEffectsPayload } | null = null;

function parseMonthInTimeZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "2-digit",
  }).formatToParts(now);
  const monthPart = parts.find((part) => part.type === "month")?.value ?? "";
  const month = Number(monthPart);
  return Number.isFinite(month) && month >= 1 && month <= 12 ? month : now.getUTCMonth() + 1;
}

function deriveSeason(now: Date): WeatherSeason {
  const month = parseMonthInTimeZone(now, LOCATION.timezone);
  if (month >= 3 && month <= 5) return "SPRING";
  if (month >= 6 && month <= 8) return "SUMMER";
  if (month >= 9 && month <= 11) return "AUTUMN";
  return "WINTER";
}

function deriveCondition(weatherCode: number | null): WeatherCondition {
  if (weatherCode === null) return "CLEAR_OR_CLOUD";
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return "SNOW";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) return "RAIN";
  return "CLEAR_OR_CLOUD";
}

function derivePreset(condition: WeatherCondition, season: WeatherSeason): WeatherEffectPreset {
  if (condition === "SNOW") return "SNOW";
  if (condition === "RAIN") return "RAIN";
  if (season === "SPRING") return "BLOSSOM";
  if (season === "AUTUMN") return "MAPLE";
  return "BREEZE";
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildPayload(input: {
  now: Date;
  observedAt: string | null;
  weatherCode: number | null;
  isDay: boolean | null;
  temperatureC: number | null;
  fallback: boolean;
}): DashboardWeatherEffectsPayload {
  const season = deriveSeason(input.now);
  const condition = deriveCondition(input.weatherCode);
  return {
    location: {
      name: LOCATION.name,
      latitude: LOCATION.latitude,
      longitude: LOCATION.longitude,
      timezone: LOCATION.timezone,
    },
    weather: {
      observedAt: input.observedAt,
      weatherCode: input.weatherCode,
      isDay: input.isDay,
      temperatureC: input.temperatureC,
    },
    derived: {
      season,
      condition,
      effectPreset: derivePreset(condition, season),
    },
    fallback: input.fallback,
  };
}

async function fetchCurrentWeather(now: Date): Promise<DashboardWeatherEffectsPayload> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(LOCATION.latitude));
  url.searchParams.set("longitude", String(LOCATION.longitude));
  url.searchParams.set("current", "weather_code,is_day,temperature_2m");
  url.searchParams.set("timezone", LOCATION.timezone);
  url.searchParams.set("forecast_days", "1");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Open-Meteo response ${response.status}`);
    }
    const payload = (await response.json()) as WeatherApiPayload;
    const current = payload.current;
    return buildPayload({
      now,
      observedAt: typeof current?.time === "string" ? current.time : null,
      weatherCode: toNumber(current?.weather_code),
      isDay: typeof current?.is_day === "number" ? current.is_day === 1 : null,
      temperatureC: toNumber(current?.temperature_2m),
      fallback: false,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getDashboardWeatherEffects(now = new Date()): Promise<DashboardWeatherEffectsPayload> {
  const nowMs = now.getTime();
  if (cacheEntry && cacheEntry.expiresAt > nowMs) {
    return cacheEntry.value;
  }

  try {
    const fresh = await fetchCurrentWeather(now);
    cacheEntry = {
      expiresAt: nowMs + CACHE_TTL_MS,
      value: fresh,
    };
    return fresh;
  } catch {
    if (cacheEntry) {
      return {
        ...cacheEntry.value,
        fallback: true,
      };
    }
    return buildPayload({
      now,
      observedAt: null,
      weatherCode: null,
      isDay: null,
      temperatureC: null,
      fallback: true,
    });
  }
}
