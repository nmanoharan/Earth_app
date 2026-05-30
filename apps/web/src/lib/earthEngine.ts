import ee from "@google/earthengine";
import { GoogleAuth } from "google-auth-library";
import { type ForestLayerId } from "@forest/shared";
import {
  getTileCacheStatus,
  readTileCache,
  type TileCacheEntry,
  writeTileCache
} from "./tileCache";

const DYNAMIC_WORLD_COLLECTION = "GOOGLE/DYNAMICWORLD/V1";
const DYNAMIC_WORLD_MIN_DATE = "2015-06-27";
const DYNAMIC_WORLD_US_VISIBLE_MIN_DATE = "2015-07-15";
const DYNAMIC_WORLD_MIN_YEAR = 2015;
const DYNAMIC_WORLD_DAILY_LOOKBACK_DAYS = 30;
const EARTH_ENGINE_TIMEOUT_MS = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EARTH_ENGINE_SCOPES = [
  "https://www.googleapis.com/auth/earthengine",
  "https://www.googleapis.com/auth/cloud-platform"
];
const DYNAMIC_WORLD_PALETTE = [
  "419bdf",
  "397d49",
  "88b053",
  "7a87c6",
  "e49635",
  "dfc35a",
  "c4281b",
  "a59b8f",
  "b39fe1"
];
const US_BOUNDS_COORDS = [-125, 24, -66, 50];

type EarthEngineMapId = {
  mapid: string;
  token?: string;
  urlFormat?: string;
  formatTileUrl?: (x: number, y: number, z: number) => string;
};
type AuthenticatedTile = {
  body: Uint8Array;
  cacheStatus?: "hit" | "miss" | "skip" | "wait";
  contentType: string;
  status: number;
};

type EarthEngineConfigStatus = {
  configured: boolean;
  message: string;
};

const DYNAMIC_WORLD_LATEST_DATE_LOOKBACK_DAYS = [45, 180, 365, 900, 1800, 5000];
const TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const mapIdCache = new Map<string, Promise<EarthEngineMapId | null>>();
const dynamicWorldTileInflight = new Map<string, Promise<AuthenticatedTile>>();
const googleAuth = new GoogleAuth({
  scopes: EARTH_ENGINE_SCOPES
});
let initializationPromise: Promise<void> | null = null;
let earliestDynamicWorldDatePromise: Promise<string> | null = null;
let latestDynamicWorldDatePromise: Promise<string> | null = null;

function getCurrentDynamicWorldYear() {
  return new Date().getFullYear();
}

function parseUtcDate(date: string) {
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function formatUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const parsedDate = parseUtcDate(date);
  if (!parsedDate) {
    return date;
  }

  parsedDate.setUTCDate(parsedDate.getUTCDate() + days);
  return formatUtcDate(parsedDate);
}

function daysBetween(startDate: string, endDate: string) {
  const start = parseUtcDate(startDate)?.getTime();
  const end = parseUtcDate(endDate)?.getTime();

  if (start === undefined || end === undefined) {
    return 0;
  }

  return Math.max(0, Math.round((end - start) / MS_PER_DAY));
}

function addYears(date: string, years: number) {
  const parsedDate = parseUtcDate(date);
  if (!parsedDate) {
    return date;
  }

  const month = parsedDate.getUTCMonth();
  parsedDate.setUTCFullYear(parsedDate.getUTCFullYear() + years);

  if (parsedDate.getUTCMonth() !== month) {
    parsedDate.setUTCDate(0);
  }

  return formatUtcDate(parsedDate);
}

function getCurrentUtcDate() {
  return formatUtcDate(new Date());
}

function withTimeout<T>(promise: Promise<T>, message: string) {
  let timeout: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), EARTH_ENGINE_TIMEOUT_MS);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function jsonTile(message: string, status: number): AuthenticatedTile {
  return {
    body: new TextEncoder().encode(JSON.stringify({ error: message })),
    contentType: "application/json",
    status
  };
}

function transparentPngTile(): AuthenticatedTile {
  return {
    body: new Uint8Array(Buffer.from(TRANSPARENT_PNG_BASE64, "base64")),
    cacheStatus: "skip",
    contentType: "image/png",
    status: 200
  };
}

function tileFromCache(cachedTile: TileCacheEntry, cacheStatus: AuthenticatedTile["cacheStatus"]) {
  return {
    body: cachedTile.bytes.slice(),
    cacheStatus,
    contentType: cachedTile.contentType,
    status: cachedTile.status
  };
}

function getDynamicWorldTileCacheKey({
  date,
  layerId,
  x,
  y,
  z
}: {
  date: string;
  layerId: ForestLayerId;
  x: number;
  y: number;
  z: number;
}) {
  return `${layerId}:${date}:${z}:${x}:${y}`;
}

async function getCachedDynamicWorldTile(
  cacheKey: string,
  fetchTile: () => Promise<AuthenticatedTile>
) {
  const cachedTile = await readTileCache(cacheKey);
  if (cachedTile) {
    return tileFromCache(cachedTile, "hit");
  }

  const inflightTile = dynamicWorldTileInflight.get(cacheKey);
  if (inflightTile) {
    const tile = await inflightTile;

    return {
      ...tile,
      body: tile.body instanceof Uint8Array ? tile.body.slice() : tile.body,
      cacheStatus: tile.status === 200 ? "wait" : tile.cacheStatus
    };
  }

  const tilePromise = fetchTile()
    .then(async (tile) => {
      await writeTileCache(cacheKey, {
        bytes: tile.body,
        contentType: tile.contentType,
        status: tile.status
      });
      return {
        ...tile,
        cacheStatus: tile.status === 200 ? ("miss" as const) : tile.cacheStatus
      };
    })
    .finally(() => {
      dynamicWorldTileInflight.delete(cacheKey);
    });

  dynamicWorldTileInflight.set(cacheKey, tilePromise);
  const tile = await tilePromise;

  return {
    ...tile,
    body: tile.body instanceof Uint8Array ? tile.body.slice() : tile.body
  };
}

async function getAdcAccessToken() {
  const client = await googleAuth.getClient();
  const accessTokenResponse = await client.getAccessToken();
  const token =
    typeof accessTokenResponse === "string" ? accessTokenResponse : accessTokenResponse?.token;

  if (!token) {
    throw new Error(
      "Google Application Default Credentials did not return an access token. Run gcloud auth application-default login."
    );
  }

  const credentials = client.credentials as { expiry_date?: number };
  const expiresIn = credentials.expiry_date
    ? Math.max(60, Math.floor((credentials.expiry_date - Date.now()) / 1000))
    : 3600;

  return {
    expiresIn,
    token
  };
}

async function getAdcRequestHeaders(url?: string) {
  const client = await googleAuth.getClient();
  const headers = (await client.getRequestHeaders(url)) as unknown;

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  return headers as Record<string, string>;
}

function installAdcTokenRefresher() {
  ee.data.setAuthTokenRefresher(
    (_authArgs: unknown, callback: (response: Record<string, unknown>) => void) => {
      getAdcAccessToken()
        .then(({ expiresIn, token }) =>
          callback({
            access_token: token,
            expires_in: expiresIn,
            token_type: "Bearer"
          })
        )
        .catch((error: Error) =>
          callback({
            error: error.message
          })
        );
    }
  );
}

export async function getEarthEngineConfigStatus(): Promise<EarthEngineConfigStatus> {
  const hasProject = Boolean(process.env.EE_PROJECT || process.env.GOOGLE_CLOUD_PROJECT);

  if (!hasProject) {
    return {
      configured: false,
      message: "Add EE_PROJECT to enable Google Earth Engine tiles."
    };
  }

  try {
    await getAdcAccessToken();
  } catch {
    return {
      configured: false,
      message:
        "Run gcloud auth application-default login with Earth Engine scopes to enable Google Earth Engine tiles."
    };
  }

  return {
    configured: true,
    message:
      "Google Application Default Credentials are configured for Earth Engine Dynamic World V1 tiles."
  };
}

async function hasDynamicWorldImages(startDate: string, endDate: string, region?: unknown) {
  let collection = ee.ImageCollection(DYNAMIC_WORLD_COLLECTION).filterDate(startDate, endDate);

  if (region) {
    collection = collection.filterBounds(region);
  }

  const collectionSize = collection.limit(1).size();

  return new Promise<boolean>((resolve, reject) => {
    collectionSize.getInfo((value: number | undefined, error?: string) => {
      if (error) {
        reject(new Error(error));
        return;
      }

      resolve(Number(value ?? 0) > 0);
    });
  });
}

export async function getEarliestDynamicWorldDate() {
  if (earliestDynamicWorldDatePromise) {
    return earliestDynamicWorldDatePromise;
  }

  earliestDynamicWorldDatePromise = withTimeout(
    (async () => {
      await initializeEarthEngine();
      const firstDate = ee
        .ImageCollection(DYNAMIC_WORLD_COLLECTION)
        .filterBounds(usBoundsGeometry())
        .aggregate_min("system:time_start");
      const firstDateString = ee
        .Date(firstDate)
        .format("YYYY-MM-dd");

      return new Promise<string>((resolve, reject) => {
        firstDateString.getInfo((value: string | undefined, error?: string) => {
          if (error) {
            reject(new Error(error));
            return;
          }

          if (!value || !parseUtcDate(value)) {
            reject(new Error("Earth Engine did not return an earliest Dynamic World date."));
            return;
          }

          resolve(value);
        });
      });
    })(),
    `Earth Engine did not return the earliest Dynamic World date within ${
      EARTH_ENGINE_TIMEOUT_MS / 1000
    } seconds.`
  ).catch((error) => {
    earliestDynamicWorldDatePromise = null;
    throw error;
  });

  return earliestDynamicWorldDatePromise;
}

async function latestDateInsideWindow(startDate: string, endDate: string, region: unknown) {
  let lowDate = startDate;
  let highDate = endDate;

  while (daysBetween(lowDate, highDate) > 1) {
    const midpointDate = addDays(lowDate, Math.floor(daysBetween(lowDate, highDate) / 2));

    if (await hasDynamicWorldImages(midpointDate, highDate, region)) {
      lowDate = midpointDate;
    } else {
      highDate = midpointDate;
    }
  }

  return lowDate;
}

export async function getLatestDynamicWorldDate() {
  if (latestDynamicWorldDatePromise) {
    return latestDynamicWorldDatePromise;
  }

  latestDynamicWorldDatePromise = withTimeout(
    (async () => {
      await initializeEarthEngine();
      const endDate = addDays(getCurrentUtcDate(), 1);
      const region = usBoundsGeometry();

      for (const lookbackDays of DYNAMIC_WORLD_LATEST_DATE_LOOKBACK_DAYS) {
        const startDate = addDays(endDate, -lookbackDays);
        if (await hasDynamicWorldImages(startDate, endDate, region)) {
          return latestDateInsideWindow(startDate, endDate, region);
        }
      }

      throw new Error("Earth Engine did not return a latest Dynamic World date.");
    })(),
    `Earth Engine did not return the latest Dynamic World date within ${
      EARTH_ENGINE_TIMEOUT_MS / 1000
    } seconds.`
  ).catch((error) => {
    latestDynamicWorldDatePromise = null;
    throw error;
  });

  return latestDynamicWorldDatePromise;
}

async function initializeEarthEngine() {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const project = process.env.EE_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

    if (!project) {
      throw new Error("Add EE_PROJECT to enable Google Earth Engine tiles.");
    }

    installAdcTokenRefresher();
    const { expiresIn, token } = await getAdcAccessToken();
    ee.data.setAuthToken(
      "application-default",
      "Bearer",
      token,
      expiresIn,
      EARTH_ENGINE_SCOPES,
      undefined,
      false
    );

    await new Promise<void>((resolve, reject) => {
      ee.initialize(
        null,
        null,
        () => {
          ee.data.setProject(project);
          resolve();
        },
        (error: string) => reject(new Error(error)),
        null,
        project
      );
    });
  })();

  return initializationPromise;
}

function usBoundsGeometry() {
  return ee.Geometry.Rectangle(US_BOUNDS_COORDS, null, false);
}

function dynamicWorldCollectionForDate(date: string, region: unknown) {
  const start = addDays(date, -DYNAMIC_WORLD_DAILY_LOOKBACK_DAYS + 1);
  const end = addDays(date, 1);

  return ee
    .ImageCollection(DYNAMIC_WORLD_COLLECTION)
    .filterDate(start, end)
    .filterBounds(usBoundsGeometry())
    .filterBounds(region);
}

function dynamicWorldMosaicForDate(date: string, region: unknown) {
  return dynamicWorldCollectionForDate(date, region)
    .sort("system:time_start")
    .mosaic()
    .clip(region);
}

function treeProbabilityForDate(date: string, region: unknown) {
  return dynamicWorldMosaicForDate(date, region).select("trees");
}

function imageForLayer(layerId: ForestLayerId, date: string, region: unknown) {
  if (layerId === "treeCover") {
    const trees = treeProbabilityForDate(date, region);
    return {
      image: trees.updateMask(trees.gte(0.28)),
      visParams: {
        min: 0.28,
        max: 0.9,
        palette: ["d9f0c2", "78c679", "238443", "004529"],
        format: "png"
      }
    };
  }

  if (layerId === "forestLoss") {
    const previousTrees = treeProbabilityForDate(addYears(date, -1), region);
    const currentTrees = treeProbabilityForDate(date, region);
    const probabilityDrop = previousTrees.subtract(currentTrees).clip(region);

    return {
      image: probabilityDrop.updateMask(probabilityDrop.gte(0.2)),
      visParams: {
        min: 0.2,
        max: 0.7,
        palette: ["fdd49e", "fc8d59", "d7301f", "7f0000"],
        format: "png"
      }
    };
  }

  const landCover = dynamicWorldMosaicForDate(date, region).select("label").clip(region);

  return {
    image: landCover,
    visParams: {
      min: 0,
      max: 8,
      palette: DYNAMIC_WORLD_PALETTE,
      format: "png"
    }
  };
}

function assertValidRequest(layerId: string | null, date: string) {
  if (layerId !== "treeCover" && layerId !== "forestLoss" && layerId !== "landCover") {
    throw new Error("Unsupported Dynamic World layer.");
  }

  const parsedDate = parseUtcDate(date);
  if (!parsedDate || date < DYNAMIC_WORLD_MIN_DATE || parsedDate.getUTCFullYear() > getCurrentDynamicWorldYear()) {
    throw new Error(
      `Dynamic World daily layers are available from ${DYNAMIC_WORLD_MIN_DATE} through the latest available Earth Engine date.`
    );
  }
}

async function getMapId({
  date,
  layerId
}: {
  date: string;
  layerId: ForestLayerId;
}) {
  const cacheKey = `${layerId}:${date}:us-bounds`;
  const cached = mapIdCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const mapIdPromise = withTimeout(
    (async () => {
      await initializeEarthEngine();
      const region = usBoundsGeometry();

      if (
        !(await hasDynamicWorldImages(
          addDays(date, -DYNAMIC_WORLD_DAILY_LOOKBACK_DAYS + 1),
          addDays(date, 1),
          region
        ))
      ) {
        return null;
      }

      const { image, visParams } = imageForLayer(layerId, date, region);

      return new Promise<EarthEngineMapId>((resolve, reject) => {
        image.getMapId(visParams, (mapId: EarthEngineMapId | undefined, error?: string) => {
          if (error || !mapId) {
            reject(new Error(error ?? "Earth Engine did not return a map ID."));
            return;
          }

          resolve(mapId);
        });
      });
    })(),
    `Earth Engine did not return a map ID within ${EARTH_ENGINE_TIMEOUT_MS / 1000} seconds.`
  ).catch((error) => {
    mapIdCache.delete(cacheKey);
    throw error;
  });

  mapIdCache.set(cacheKey, mapIdPromise);
  return mapIdPromise;
}

async function fetchEarthEngineTile(tileUrl: string, headers: Record<string, string>) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), EARTH_ENGINE_TIMEOUT_MS);
  let tileResponse: Response;

  try {
    tileResponse = await fetch(tileUrl, {
      headers,
      next: {
        revalidate: 60 * 60 * 24 * 7
      },
      signal: abortController.signal
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `Earth Engine tile request timed out after ${EARTH_ENGINE_TIMEOUT_MS / 1000} seconds.`
        : "Earth Engine tile request failed.";

    return jsonTile(message, 504);
  } finally {
    clearTimeout(timeout);
  }

  if (!tileResponse.ok) {
    const errorText = await tileResponse.text().catch(() => "");
    return jsonTile(
      errorText || `Earth Engine tile request failed with ${tileResponse.status}.`,
      tileResponse.status || 502
    );
  }

  return {
    body: new Uint8Array(await tileResponse.arrayBuffer()),
    cacheStatus: "skip" as const,
    contentType: tileResponse.headers.get("content-type") ?? "image/png",
    status: tileResponse.status
  };
}

export async function getDynamicWorldTile({
  date,
  layerId,
  x,
  y,
  z
}: {
  date: string;
  layerId: string | null;
  x: number;
  y: number;
  z: number;
}): Promise<AuthenticatedTile> {
  assertValidRequest(layerId, date);

  const typedLayerId = layerId as ForestLayerId;
  const mapId = await getMapId({
    date,
    layerId: typedLayerId
  });
  const cacheKey = getDynamicWorldTileCacheKey({
    date,
    layerId: typedLayerId,
    x,
    y,
    z
  });

  if (!mapId) {
    return getCachedDynamicWorldTile(cacheKey, () => Promise.resolve(transparentPngTile()));
  }

  const tileUrl = ee.data.getTileUrl(mapId, x, y, z) as string;
  const headers = await getAdcRequestHeaders(tileUrl);

  return getCachedDynamicWorldTile(cacheKey, () => fetchEarthEngineTile(tileUrl, headers));
}

export const dynamicWorldMetadata = {
  attribution:
    "Dynamic World V1 by Google, World Resources Institute, National Geographic Society; contains modified Copernicus Sentinel data.",
  lookbackDays: DYNAMIC_WORLD_DAILY_LOOKBACK_DAYS,
  minDate: DYNAMIC_WORLD_US_VISIBLE_MIN_DATE,
  maxYear: getCurrentDynamicWorldYear(),
  minYear: DYNAMIC_WORLD_MIN_YEAR,
  source: DYNAMIC_WORLD_COLLECTION
};

export function getDynamicWorldTileCacheStatus() {
  return getTileCacheStatus();
}
