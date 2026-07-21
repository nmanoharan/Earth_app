import { createClient } from "redis";

type RedisClient = {
  connect: () => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  on: (event: "error", listener: (error: unknown) => void) => unknown;
  setEx: (key: string, seconds: number, value: string) => Promise<unknown>;
};

export type TileCacheBackend = "memory" | "none" | "redis";
export type TileCacheEntry = {
  bytes: Uint8Array;
  contentType: string;
  status: number;
};

type MemoryTile = TileCacheEntry & {
  expiresAt: number;
  size: number;
};

type SerializedTile = {
  bodyBase64: string;
  contentType: string;
  status: number;
};
type SerializedTimelineDate = {
  layers: string[];
  updatedAt: string;
};
type TimelineDateMarker = {
  expiresAt: number;
  layers: Set<string>;
  updatedAt: string;
};

const DEFAULT_TILE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7;
const DEFAULT_MEMORY_CACHE_MAX_BYTES = 24 * 1024 * 1024;
const DEFAULT_MEMORY_CACHE_MAX_ENTRIES = 240;
const TILE_CACHE_KEY_PREFIX = process.env.TILE_CACHE_KEY_PREFIX || "forest:dynamic-world:tile:";
const TIMELINE_DATE_CACHE_KEY_PREFIX =
  process.env.TIMELINE_DATE_CACHE_KEY_PREFIX || "forest:dynamic-world:timeline-date:";

const memoryCache = new Map<string, MemoryTile>();
const memoryTimelineDateCache = new Map<string, TimelineDateMarker>();
let memoryCacheBytes = 0;
let redisClientPromise: Promise<RedisClient | null> | null = null;

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getCacheTtlSeconds() {
  return numberFromEnv("TILE_CACHE_TTL_SECONDS", DEFAULT_TILE_CACHE_TTL_SECONDS);
}

function getMemoryMaxBytes() {
  return numberFromEnv("TILE_CACHE_MEMORY_MAX_BYTES", DEFAULT_MEMORY_CACHE_MAX_BYTES);
}

function getMemoryMaxEntries() {
  return numberFromEnv("TILE_CACHE_MEMORY_MAX_ENTRIES", DEFAULT_MEMORY_CACHE_MAX_ENTRIES);
}

function getRedisUrl() {
  if (process.env.TILE_CACHE_REDIS_URL) {
    return process.env.TILE_CACHE_REDIS_URL;
  }

  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }

  if (process.env.REDISHOST) {
    return `redis://${process.env.REDISHOST}:${process.env.REDISPORT || "6379"}`;
  }

  return "";
}

function getCacheBackend(): TileCacheBackend {
  const configuredBackend = process.env.TILE_CACHE_BACKEND?.toLowerCase();

  if (configuredBackend === "none" || configuredBackend === "redis") {
    return configuredBackend;
  }

  if (configuredBackend === "memory") {
    return "memory";
  }

  return getRedisUrl() ? "redis" : "memory";
}

function cacheKey(key: string) {
  return `${TILE_CACHE_KEY_PREFIX}${key}`;
}

function timelineDateCacheKey(date: string) {
  return `${TIMELINE_DATE_CACHE_KEY_PREFIX}${date}`;
}

function cloneEntry(entry: TileCacheEntry): TileCacheEntry {
  return {
    bytes: entry.bytes.slice(),
    contentType: entry.contentType,
    status: entry.status
  };
}

function serializeEntry(entry: TileCacheEntry): string {
  return JSON.stringify({
    bodyBase64: Buffer.from(entry.bytes).toString("base64"),
    contentType: entry.contentType,
    status: entry.status
  } satisfies SerializedTile);
}

function serializeTimelineDate(entry: TimelineDateMarker): string {
  return JSON.stringify({
    layers: [...entry.layers].sort(),
    updatedAt: entry.updatedAt
  } satisfies SerializedTimelineDate);
}

function deserializeTimelineDate(value: string): SerializedTimelineDate | null {
  try {
    const parsed = JSON.parse(value) as Partial<SerializedTimelineDate>;
    if (!Array.isArray(parsed.layers) || typeof parsed.updatedAt !== "string") {
      return null;
    }

    return {
      layers: parsed.layers.filter((layer) => typeof layer === "string"),
      updatedAt: parsed.updatedAt
    };
  } catch {
    return null;
  }
}

function deserializeEntry(value: string): TileCacheEntry | null {
  try {
    const parsed = JSON.parse(value) as Partial<SerializedTile>;
    if (!parsed.bodyBase64 || !parsed.contentType || typeof parsed.status !== "number") {
      return null;
    }

    return {
      bytes: new Uint8Array(Buffer.from(parsed.bodyBase64, "base64")),
      contentType: parsed.contentType,
      status: parsed.status
    };
  } catch {
    return null;
  }
}

function trimMemoryTimelineDateCache() {
  const now = Date.now();
  memoryTimelineDateCache.forEach((entry, date) => {
    if (entry.expiresAt <= now) {
      memoryTimelineDateCache.delete(date);
    }
  });
}

function trimMemoryCache() {
  while (memoryCache.size > getMemoryMaxEntries() || memoryCacheBytes > getMemoryMaxBytes()) {
    const oldestKey = memoryCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      return;
    }

    const oldestTile = memoryCache.get(oldestKey);
    memoryCache.delete(oldestKey);

    if (oldestTile) {
      memoryCacheBytes -= oldestTile.size;
    }
  }
}

function readMemoryTimelineDateCache(dates: string[]) {
  trimMemoryTimelineDateCache();

  return Object.fromEntries(
    dates.map((date) => [
      date,
      [...(memoryTimelineDateCache.get(date)?.layers ?? new Set<string>())]
    ])
  );
}

function writeMemoryTimelineDateCache(date: string, layerId: string) {
  trimMemoryTimelineDateCache();

  const existingEntry = memoryTimelineDateCache.get(date);
  const layers = existingEntry?.layers ?? new Set<string>();
  layers.add(layerId);

  memoryTimelineDateCache.set(date, {
    expiresAt: Date.now() + getCacheTtlSeconds() * 1000,
    layers,
    updatedAt: new Date().toISOString()
  });
}

function readMemoryCache(key: string) {
  const entry = memoryCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    memoryCacheBytes -= entry.size;
    return null;
  }

  memoryCache.delete(key);
  memoryCache.set(key, entry);
  return cloneEntry(entry);
}

function writeMemoryCache(key: string, entry: TileCacheEntry) {
  const existingEntry = memoryCache.get(key);
  if (existingEntry) {
    memoryCacheBytes -= existingEntry.size;
  }

  const memoryEntry: MemoryTile = {
    ...cloneEntry(entry),
    expiresAt: Date.now() + getCacheTtlSeconds() * 1000,
    size: entry.bytes.byteLength
  };

  memoryCache.set(key, memoryEntry);
  memoryCacheBytes += memoryEntry.size;
  trimMemoryCache();
}

async function getRedisClient() {
  if (getCacheBackend() !== "redis") {
    return null;
  }

  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    return null;
  }

  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      const client = createClient({
        socket: {
          connectTimeout: numberFromEnv("TILE_CACHE_REDIS_CONNECT_TIMEOUT_MS", 2500)
        },
        url: redisUrl
      }) as RedisClient;

      client.on("error", (error) => {
        console.warn("Redis tile cache error:", error instanceof Error ? error.message : error);
      });

      try {
        await client.connect();
        return client;
      } catch (error) {
        console.warn(
          "Unable to connect Redis tile cache:",
          error instanceof Error ? error.message : error
        );
        redisClientPromise = null;
        return null;
      }
    })();
  }

  return redisClientPromise;
}

export async function readTileCache(key: string) {
  const backend = getCacheBackend();
  if (backend === "none") {
    return null;
  }

  if (backend === "memory") {
    return readMemoryCache(key);
  }

  const client = await getRedisClient();
  if (!client) {
    return null;
  }

  const value = await client.get(cacheKey(key)).catch((error) => {
    console.warn("Redis tile cache read failed:", error instanceof Error ? error.message : error);
    return null;
  });

  return value ? deserializeEntry(value) : null;
}

export async function writeTileCache(key: string, entry: TileCacheEntry) {
  if (entry.status !== 200 || entry.contentType.includes("application/json")) {
    return;
  }

  const backend = getCacheBackend();
  if (backend === "none") {
    return;
  }

  if (backend === "memory") {
    writeMemoryCache(key, entry);
    return;
  }

  const client = await getRedisClient();
  if (!client) {
    return;
  }

  await client.setEx(cacheKey(key), getCacheTtlSeconds(), serializeEntry(entry)).catch((error) => {
    console.warn("Redis tile cache write failed:", error instanceof Error ? error.message : error);
  });
}

export async function markTimelineDateLayerCached(date: string, layerId: string) {
  const backend = getCacheBackend();
  if (backend === "none") {
    return;
  }

  if (backend === "memory") {
    writeMemoryTimelineDateCache(date, layerId);
    return;
  }

  const client = await getRedisClient();
  if (!client) {
    return;
  }

  const cacheKeyForDate = timelineDateCacheKey(date);
  const existingValue = await client.get(cacheKeyForDate).catch((error) => {
    console.warn(
      "Redis timeline cache read failed:",
      error instanceof Error ? error.message : error
    );
    return null;
  });
  const existingLayers = existingValue
    ? deserializeTimelineDate(existingValue)?.layers ?? []
    : [];
  const marker: TimelineDateMarker = {
    expiresAt: Date.now() + getCacheTtlSeconds() * 1000,
    layers: new Set([...existingLayers, layerId]),
    updatedAt: new Date().toISOString()
  };

  await client
    .setEx(cacheKeyForDate, getCacheTtlSeconds(), serializeTimelineDate(marker))
    .catch((error) => {
      console.warn(
        "Redis timeline cache write failed:",
        error instanceof Error ? error.message : error
      );
    });
}

export async function readTimelineDateLayerCache(dates: string[]) {
  const backend = getCacheBackend();
  const emptyResult = Object.fromEntries(dates.map((date) => [date, [] as string[]]));

  if (backend === "none" || dates.length === 0) {
    return emptyResult;
  }

  if (backend === "memory") {
    return readMemoryTimelineDateCache(dates);
  }

  const client = await getRedisClient();
  if (!client) {
    return emptyResult;
  }

  const entries = await Promise.all(
    dates.map(async (date) => {
      const value = await client.get(timelineDateCacheKey(date)).catch((error) => {
        console.warn(
          "Redis timeline cache read failed:",
          error instanceof Error ? error.message : error
        );
        return null;
      });
      return [date, value ? deserializeTimelineDate(value)?.layers ?? [] : []] as const;
    })
  );

  return Object.fromEntries(entries);
}

export function getTileCacheStatus() {
  return {
    backend: getCacheBackend(),
    memoryMaxBytes: getMemoryMaxBytes(),
    memoryMaxEntries: getMemoryMaxEntries(),
    redisConfigured: Boolean(getRedisUrl()),
    ttlSeconds: getCacheTtlSeconds()
  };
}
