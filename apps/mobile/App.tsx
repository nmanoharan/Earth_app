import { StatusBar } from "expo-status-bar";
import Slider from "@react-native-community/slider";
import * as FileSystem from "expo-file-system";
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import MapView, { PROVIDER_DEFAULT, UrlTile, type Region } from "react-native-maps";
import { forestLayerConfigs, type ForestLayerId } from "@forest/shared";

type EarthEngineStatus = {
  configured: boolean;
  earliestAvailableDate?: string;
  latestAvailableDate?: string;
  message: string;
};
type SearchResult = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  zoom: number;
  type: "state" | "city";
};
type SearchStatus = "idle" | "loading" | "empty" | "error";
type TileLoadStatus = "idle" | "loading" | "loaded";
type TimelineCacheStatus = {
  complete: boolean;
  enabledDates: string[];
  progress: number;
  readyCount: number;
  readyDates: string[];
  totalCount: number;
  warmed?: {
    date: string;
    layerId: ForestLayerId;
    status: number;
  };
};
type PersistedMobilePreferences = {
  searchQuery?: string;
  selectedDate?: string;
  searchTarget?: SearchResult;
  visibleLayers?: Partial<Record<ForestLayerId, boolean>>;
};

const DEFAULT_TILE_API_BASE_URL = "http://127.0.0.1:3001";
const TILE_API_BASE_URL =
  process.env.EXPO_PUBLIC_TILE_API_BASE_URL?.replace(/\/$/, "") ?? DEFAULT_TILE_API_BASE_URL;
const MOBILE_API_TOKEN = process.env.EXPO_PUBLIC_MOBILE_API_TOKEN?.trim() ?? "";
const MIN_DYNAMIC_WORLD_DATE = "2015-07-15";
const MIN_MAP_ZOOM = 3;
const MAX_EARTH_ENGINE_NATIVE_ZOOM = 14;
const MAX_MAP_ZOOM = 20;
const TIMELINE_VISIBLE_MONTH_COUNT = 12;
const TIMELINE_YEAR_STEP_MONTHS = 12;
const TIMELINE_CACHE_ACTIVE_INTERVAL_MS = 300;
const TIMELINE_CACHE_COMPLETE_INTERVAL_MS = 15_000;
const MOBILE_PREFERENCES_PATH = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}oeoc-earth-preferences-v1.json`
  : "";
const initialLayers = forestLayerConfigs.reduce(
  (layers, layer) => ({
    ...layers,
    [layer.id]: layer.id === "treeCover" || layer.id === "forestLoss"
  }),
  {} as Record<ForestLayerId, boolean>
);
const defaultRegion: Region = {
  latitude: 39.5,
  longitude: -98.35,
  latitudeDelta: 35,
  longitudeDelta: 35
};

function isDateValue(value?: string) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function parseDateValue(value: string) {
  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsedDate.getTime())
    ? new Date(`${MIN_DYNAMIC_WORLD_DATE}T00:00:00.000Z`)
    : parsedDate;
}

function formatDateValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isSameUtcMonth(firstDate: string, secondDate: string) {
  const first = parseDateValue(firstDate);
  const second = parseDateValue(secondDate);

  return (
    first.getUTCFullYear() === second.getUTCFullYear() &&
    first.getUTCMonth() === second.getUTCMonth()
  );
}

function clampDate(value: string, minValue: string, maxValue: string) {
  if (value < minValue) {
    return minValue;
  }

  if (value > maxValue) {
    return maxValue;
  }

  return value;
}

function pushMonthlyDate(dates: string[], nextDate: string) {
  const previousDate = dates.at(-1);

  if (!previousDate) {
    dates.push(nextDate);
    return;
  }

  if (previousDate === nextDate) {
    return;
  }

  if (isSameUtcMonth(previousDate, nextDate)) {
    dates[dates.length - 1] = nextDate;
    return;
  }

  dates.push(nextDate);
}

function buildMonthlyTimelineDates(startDate: string, endDate: string) {
  if (!isDateValue(startDate) || !isDateValue(endDate) || endDate < startDate) {
    return [];
  }

  const dates: string[] = [];
  const start = parseDateValue(startDate);
  const end = parseDateValue(endDate);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

  while (cursor <= end) {
    const monthEndDate = formatDateValue(
      new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0))
    );

    pushMonthlyDate(dates, clampDate(monthEndDate, startDate, endDate));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  pushMonthlyDate(dates, endDate);

  return dates;
}

function nearestDateIndex(dates: string[], targetDate: string) {
  if (dates.length === 0 || !isDateValue(targetDate)) {
    return 0;
  }

  const targetTime = parseDateValue(targetDate).getTime();
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  dates.forEach((date, index) => {
    const distance = Math.abs(parseDateValue(date).getTime() - targetTime);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function isSearchResult(value: unknown): value is SearchResult {
  const result = value as Partial<SearchResult>;

  return (
    typeof result?.id === "string" &&
    typeof result.label === "string" &&
    typeof result.lat === "number" &&
    typeof result.lng === "number" &&
    typeof result.zoom === "number" &&
    (result.type === "state" || result.type === "city")
  );
}

async function readPersistedMobilePreferences() {
  if (!MOBILE_PREFERENCES_PATH) {
    return {};
  }

  try {
    const rawPreferences = await FileSystem.readAsStringAsync(MOBILE_PREFERENCES_PATH);
    const parsed = JSON.parse(rawPreferences) as PersistedMobilePreferences;

    return {
      searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery : undefined,
      searchTarget: isSearchResult(parsed.searchTarget) ? parsed.searchTarget : undefined,
      selectedDate: isDateValue(parsed.selectedDate) ? parsed.selectedDate : undefined,
      visibleLayers: parsed.visibleLayers
    } satisfies PersistedMobilePreferences;
  } catch {
    return {};
  }
}

async function writePersistedMobilePreferences(preferences: PersistedMobilePreferences) {
  if (!MOBILE_PREFERENCES_PATH) {
    return;
  }

  try {
    await FileSystem.writeAsStringAsync(MOBILE_PREFERENCES_PATH, JSON.stringify(preferences));
  } catch {
    // Preference persistence should never block the map.
  }
}

function buildTileUrl(layerId: ForestLayerId, date: string) {
  const params = [
    `date=${encodeURIComponent(date)}`,
    `layerId=${encodeURIComponent(layerId)}`,
    "x={x}",
    "y={y}",
    "z={z}",
    MOBILE_API_TOKEN ? `mobileToken=${encodeURIComponent(MOBILE_API_TOKEN)}` : ""
  ]
    .filter(Boolean)
    .join("&");

  return `${TILE_API_BASE_URL}/api/earth-engine/tiles?${params}`;
}

function buildTileCachePath(layerId: ForestLayerId, date: string) {
  return FileSystem.cacheDirectory
    ? `${FileSystem.cacheDirectory}earth-tiles/v1/${layerId}/${date}`
    : undefined;
}

function appendMobileApiToken(url: string) {
  if (!MOBILE_API_TOKEN) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}mobileToken=${encodeURIComponent(MOBILE_API_TOKEN)}`;
}

function regionForTarget(target: SearchResult): Region {
  const delta = Math.max(0.08, Math.min(35, 360 / 2 ** target.zoom));

  return {
    latitude: target.lat,
    longitude: target.lng,
    latitudeDelta: delta,
    longitudeDelta: delta
  };
}

function zoomFromRegion(region: Region) {
  const rawZoom = Math.log2(360 / Math.max(region.longitudeDelta, 0.0001));
  return Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, Math.round(rawZoom)));
}

export default function App() {
  const mapRef = useRef<ComponentRef<typeof MapView> | null>(null);
  const lastTileZoomLevelRef = useRef(zoomFromRegion(defaultRegion));
  const timelineCachePulseRef = useRef(new Animated.Value(0.55));
  const timelineCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [timelinePreviewDate, setTimelinePreviewDate] = useState("");
  const [earliestDate, setEarliestDate] = useState(MIN_DYNAMIC_WORLD_DATE);
  const [latestDate, setLatestDate] = useState("");
  const [persistedSelectedDate, setPersistedSelectedDate] = useState("");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchTarget, setSearchTarget] = useState<SearchResult>();
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [status, setStatus] = useState<EarthEngineStatus>({
    configured: false,
    message: "Checking Google Earth Engine tiles."
  });
  const [controlsExpanded, setControlsExpanded] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [timelineCacheStatus, setTimelineCacheStatus] = useState<TimelineCacheStatus>();
  const [timelineCacheWarming, setTimelineCacheWarming] = useState(false);
  const [timelineWindowEndIndexPreference, setTimelineWindowEndIndexPreference] =
    useState<number>();
  const [tileLoadStatus, setTileLoadStatus] = useState<TileLoadStatus>("idle");
  const [tileZoomLevel, setTileZoomLevel] = useState(zoomFromRegion(defaultRegion));
  const [visibleLayers, setVisibleLayers] =
    useState<Record<ForestLayerId, boolean>>(initialLayers);

  const activeCount = useMemo(
    () => Object.values(visibleLayers).filter(Boolean).length,
    [visibleLayers]
  );
  const hasDateRange = Boolean(latestDate);
  const requestedTileDate = timelinePreviewDate || selectedDate || latestDate;
  const monthlyTimelineDates = useMemo(
    () => (latestDate ? buildMonthlyTimelineDates(earliestDate, latestDate) : []),
    [earliestDate, latestDate]
  );
  const fullTimelineMaxIndex = Math.max(0, monthlyTimelineDates.length - 1);
  const timelineLayerIds = useMemo(() => {
    const selectedLayerIds = forestLayerConfigs
      .filter((layer) => visibleLayers[layer.id])
      .map((layer) => layer.id);

    return selectedLayerIds.length > 0 ? selectedLayerIds : (["treeCover"] as ForestLayerId[]);
  }, [visibleLayers]);
  const selectedDateTimelineIndex = useMemo(
    () => nearestDateIndex(monthlyTimelineDates, selectedDate || latestDate),
    [latestDate, monthlyTimelineDates, selectedDate]
  );
  const timelineWindowMinEndIndex = Math.min(
    fullTimelineMaxIndex,
    Math.max(0, TIMELINE_VISIBLE_MONTH_COUNT - 1)
  );
  const effectiveTimelineWindowEndIndex = Math.min(
    fullTimelineMaxIndex,
    Math.max(
      timelineWindowMinEndIndex,
      timelineWindowEndIndexPreference ?? fullTimelineMaxIndex
    )
  );
  const timelineWindowStartIndex = Math.max(
    0,
    effectiveTimelineWindowEndIndex - TIMELINE_VISIBLE_MONTH_COUNT + 1
  );
  const timelineWindowStartDate = monthlyTimelineDates[timelineWindowStartIndex] ?? earliestDate;
  const timelineWindowEndDate =
    monthlyTimelineDates[effectiveTimelineWindowEndIndex] ?? latestDate;
  const cachedTimelineDates = useMemo(() => {
    const enabledDateSet = new Set(timelineCacheStatus?.enabledDates ?? []);
    const enabledDates = monthlyTimelineDates.filter(
      (date) =>
        date >= timelineWindowStartDate &&
        date <= timelineWindowEndDate &&
        enabledDateSet.has(date)
    );

    if (enabledDates.length > 0) {
      return enabledDates;
    }

    return timelineWindowEndDate ? [timelineWindowEndDate] : [];
  }, [monthlyTimelineDates, timelineCacheStatus, timelineWindowEndDate, timelineWindowStartDate]);
  const cachedRangeStartDate = cachedTimelineDates[0] ?? timelineWindowEndDate;
  const cachedRangeEndDate = cachedTimelineDates.at(-1) ?? timelineWindowEndDate;
  const activeTileDate =
    requestedTileDate && latestDate ? clampDate(requestedTileDate, earliestDate, latestDate) : "";
  const timelineDisplayDate = activeTileDate;
  const rawTimelineDisplayIndex = useMemo(
    () => nearestDateIndex(monthlyTimelineDates, timelineDisplayDate),
    [monthlyTimelineDates, timelineDisplayDate]
  );
  const timelineDisplayIndex = useMemo(
    () =>
      Math.max(
        timelineWindowStartIndex,
        Math.min(effectiveTimelineWindowEndIndex, rawTimelineDisplayIndex)
      ),
    [
      effectiveTimelineWindowEndIndex,
      rawTimelineDisplayIndex,
      timelineWindowStartIndex
    ]
  );
  const selectedTimelineIndex = useMemo(
    () => nearestDateIndex(monthlyTimelineDates, activeTileDate),
    [activeTileDate, monthlyTimelineDates]
  );
  const cachedTimelineStartIndex = useMemo(
    () => nearestDateIndex(monthlyTimelineDates, cachedRangeStartDate),
    [cachedRangeStartDate, monthlyTimelineDates]
  );
  const timelineReadyStartIndex = Math.min(
    effectiveTimelineWindowEndIndex,
    Math.max(cachedTimelineStartIndex, timelineWindowStartIndex)
  );
  const timelineWindowSpan = Math.max(
    1,
    effectiveTimelineWindowEndIndex - timelineWindowStartIndex
  );
  const cacheReadyStartPercent =
    ((timelineReadyStartIndex - timelineWindowStartIndex) / timelineWindowSpan) * 100;
  const canStepBack = Boolean(selectedDate && selectedTimelineIndex > 0);
  const canStepForward = Boolean(
    selectedDate && selectedTimelineIndex < fullTimelineMaxIndex
  );
  const hasMultipleSelectableTimelineDates = Boolean(
    hasDateRange && timelineWindowStartIndex < effectiveTimelineWindowEndIndex
  );
  const previousTimelineWindowEndIndex =
    effectiveTimelineWindowEndIndex - TIMELINE_YEAR_STEP_MONTHS;
  const nextTimelineWindowEndIndex =
    effectiveTimelineWindowEndIndex + TIMELINE_YEAR_STEP_MONTHS;
  const canJumpTimelineBackYear = Boolean(
    hasDateRange && previousTimelineWindowEndIndex >= timelineWindowMinEndIndex
  );
  const canJumpTimelineForwardYear = Boolean(
    hasDateRange && nextTimelineWindowEndIndex <= fullTimelineMaxIndex
  );
  const timelineCacheComplete = Boolean(timelineCacheStatus?.complete);
  const timelineCacheReadyText = timelineCacheStatus
    ? `${timelineCacheStatus.readyCount}/${timelineCacheStatus.totalCount} months ready`
    : "Checking cached months";
  const activeLayerLabels = useMemo(
    () =>
      forestLayerConfigs
        .filter((layer) => visibleLayers[layer.id])
        .map((layer) => layer.label),
    [visibleLayers]
  );
  const activeLayerKey = activeLayerLabels.join("|");
  const selectedDisplayDate = activeTileDate || "latest date";
  const activeTimelineDateReady = Boolean(
    activeTileDate &&
      (timelineCacheStatus?.readyDates.includes(activeTileDate) ||
        timelineCacheStatus?.enabledDates.includes(activeTileDate) ||
        tileLoadStatus === "loaded")
  );
  const timelineActiveStatusText = activeTimelineDateReady
    ? "ready"
    : timelineCacheWarming
      ? "warming"
      : "checking";
  const tileProgressText =
    activeLayerLabels.length === 0
      ? "Tiles: no layers selected"
      : tileLoadStatus === "loading"
        ? `Tiles: queued/rendering ${activeLayerLabels.join(", ")} for ${selectedDisplayDate}`
        : tileLoadStatus === "loaded"
          ? `Tiles: ${activeLayerLabels.join(", ")} loaded for ${selectedDisplayDate}`
          : `Tiles: waiting for ${activeLayerLabels.join(", ")}`;

  const updateDate = useCallback(
    (nextDate: string) => {
      if (!latestDate || !isDateValue(nextDate)) {
        return;
      }

      const clampedDate = clampDate(nextDate, earliestDate, latestDate);
      setTimelinePreviewDate("");
      setSelectedDate(
        monthlyTimelineDates[nearestDateIndex(monthlyTimelineDates, clampedDate)] ?? latestDate
      );
    },
    [earliestDate, latestDate, monthlyTimelineDates]
  );
  const clearTimelineCommitTimer = useCallback(() => {
    if (timelineCommitTimerRef.current) {
      clearTimeout(timelineCommitTimerRef.current);
      timelineCommitTimerRef.current = null;
    }
  }, []);
  const dateForTimelineIndex = useCallback(
    (timelineIndex: number) => {
      const nextIndex = Math.max(
        timelineWindowStartIndex,
        Math.min(effectiveTimelineWindowEndIndex, Math.round(timelineIndex))
      );
      return monthlyTimelineDates[nextIndex] ?? timelineWindowEndDate;
    },
    [
      effectiveTimelineWindowEndIndex,
      monthlyTimelineDates,
      timelineWindowEndDate,
      timelineWindowStartIndex
    ]
  );
  const previewTimelineDate = useCallback(
    (timelineIndex: number) => {
      if (!hasDateRange) {
        return;
      }

      const clampedDate = clampDate(dateForTimelineIndex(timelineIndex), earliestDate, latestDate);
      setTimelinePreviewDate(clampedDate);
      clearTimelineCommitTimer();
      timelineCommitTimerRef.current = setTimeout(() => {
        updateDate(clampedDate);
      }, 450);
    },
    [
      clearTimelineCommitTimer,
      dateForTimelineIndex,
      earliestDate,
      hasDateRange,
      latestDate,
      updateDate
    ]
  );
  const shiftTimelineWindowByYear = useCallback(
    (direction: -1 | 1) => {
      if (!hasDateRange || monthlyTimelineDates.length === 0) {
        return;
      }

      const nextWindowEndIndex =
        direction < 0 ? previousTimelineWindowEndIndex : nextTimelineWindowEndIndex;

      if (
        (direction < 0 && !canJumpTimelineBackYear) ||
        (direction > 0 && !canJumpTimelineForwardYear)
      ) {
        return;
      }

      setTimelineWindowEndIndexPreference(nextWindowEndIndex);
      setTimelineCacheStatus(undefined);
      setTimelinePreviewDate("");
      setTileLoadStatus("idle");
      setSelectedDate(monthlyTimelineDates[nextWindowEndIndex] ?? timelineWindowEndDate);
    },
    [
      canJumpTimelineBackYear,
      canJumpTimelineForwardYear,
      hasDateRange,
      monthlyTimelineDates,
      nextTimelineWindowEndIndex,
      previousTimelineWindowEndIndex,
      timelineWindowEndDate
    ]
  );
  const commitTimelineDate = useCallback(
    (timelineIndex: number) => {
      if (!hasDateRange) {
        return;
      }

      const nextDate = dateForTimelineIndex(timelineIndex);
      clearTimelineCommitTimer();
      updateDate(clampDate(nextDate, earliestDate, latestDate));
    },
    [
      clearTimelineCommitTimer,
      dateForTimelineIndex,
      earliestDate,
      hasDateRange,
      latestDate,
      updateDate
    ]
  );
  const refreshTilesForRegion = useCallback((region: Region) => {
    const nextZoomLevel = zoomFromRegion(region);
    if (lastTileZoomLevelRef.current === nextZoomLevel) {
      return;
    }

    lastTileZoomLevelRef.current = nextZoomLevel;
    setTileZoomLevel(nextZoomLevel);
  }, []);
  const handleRegionChangeComplete = useCallback(
    (region: Region) => {
      refreshTilesForRegion(region);
    },
    [refreshTilesForRegion]
  );
  const selectSearchResult = useCallback((result: SearchResult) => {
    setSearchStatus("idle");
    setSearchResults([]);
    setSearchTarget(result);
    setSearchQuery(result.label);
    Keyboard.dismiss();
  }, []);
  const handleSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchStatus("empty");
      return;
    }

    setSearchStatus("loading");

    try {
      const response = await fetch(
        appendMobileApiToken(`${TILE_API_BASE_URL}/api/search?q=${encodeURIComponent(query)}`)
      );
      if (!response.ok) {
        throw new Error(`Search request failed with ${response.status}.`);
      }

      const payload = (await response.json()) as { results?: SearchResult[] };
      const results = payload.results ?? [];
      setSearchResults(results);

      if (results.length === 0) {
        setSearchStatus("empty");
        return;
      }

      if (results.length === 1) {
        selectSearchResult(results[0]);
      } else {
        setSearchStatus("idle");
      }
    } catch {
      setSearchResults([]);
      setSearchStatus("error");
    }
  }, [searchQuery, selectSearchResult]);
  const requestTimelineCacheStatus = useCallback(
    async (warmNextDate: boolean) => {
      if (!status.configured || !latestDate) {
        return undefined;
      }

      const searchParams = new URLSearchParams({
        endDate: timelineWindowEndDate,
        layers: timelineLayerIds.join(","),
        startDate: timelineWindowStartDate
      });
      setTimelineCacheWarming(warmNextDate);

      try {
        const response = await fetch(
          appendMobileApiToken(`${TILE_API_BASE_URL}/api/earth-engine/timeline-cache?${searchParams}`),
          {
            method: warmNextDate ? "POST" : "GET"
          }
        );
        if (!response.ok && response.status !== 202) {
          throw new Error(`Timeline cache request failed with ${response.status}.`);
        }

        const payload = (await response.json()) as TimelineCacheStatus;
        setTimelineCacheStatus(payload);
        return payload;
      } catch {
        return undefined;
      } finally {
        setTimelineCacheWarming(false);
      }
    },
    [latestDate, status.configured, timelineLayerIds, timelineWindowEndDate, timelineWindowStartDate]
  );

  useEffect(() => {
    let ignore = false;

    async function loadPreferences() {
      const preferences = await readPersistedMobilePreferences();
      if (ignore) {
        return;
      }

      if (preferences.searchQuery) {
        setSearchQuery(preferences.searchQuery);
      }
      if (preferences.searchTarget) {
        setSearchTarget(preferences.searchTarget);
      }
      if (preferences.selectedDate) {
        setPersistedSelectedDate(preferences.selectedDate);
      }
      if (preferences.visibleLayers) {
        setVisibleLayers((currentLayers) => ({
          ...currentLayers,
          ...Object.fromEntries(
            forestLayerConfigs
              .filter((layer) => typeof preferences.visibleLayers?.[layer.id] === "boolean")
              .map((layer) => [layer.id, Boolean(preferences.visibleLayers?.[layer.id])])
          )
        }));
      }

      setPreferencesLoaded(true);
    }

    loadPreferences();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }

    let ignore = false;

    async function loadStatus() {
      try {
        const response = await fetch(
          appendMobileApiToken(`${TILE_API_BASE_URL}/api/earth-engine/status`)
        );
        if (!response.ok) {
          throw new Error(`Status request failed with ${response.status}.`);
        }

        const payload = (await response.json()) as EarthEngineStatus;
        if (ignore) {
          return;
        }

        const nextEarliestDate = isDateValue(payload.earliestAvailableDate)
          ? payload.earliestAvailableDate!
          : MIN_DYNAMIC_WORLD_DATE;
        const nextLatestDate = isDateValue(payload.latestAvailableDate)
          ? payload.latestAvailableDate!
          : "";

        setStatus(payload);
        setEarliestDate(nextEarliestDate);
        setLatestDate(nextLatestDate);
        setSelectedDate(
          persistedSelectedDate
            ? clampDate(persistedSelectedDate, nextEarliestDate, nextLatestDate || nextEarliestDate)
            : nextLatestDate
        );
        setTimelinePreviewDate("");
      } catch (error) {
        if (!ignore) {
          setStatus({
            configured: false,
            message:
              error instanceof Error
                ? error.message
                : "Unable to load Google Earth Engine status."
          });
        }
      } finally {
        if (!ignore) {
          setLoadingStatus(false);
        }
      }
    }

    loadStatus();

    return () => {
      ignore = true;
    };
  }, [persistedSelectedDate, preferencesLoaded]);

  useEffect(
    () => () => {
      clearTimelineCommitTimer();
    },
    [clearTimelineCommitTimer]
  );

  useEffect(() => {
    if (!hasDateRange || monthlyTimelineDates.length === 0) {
      return;
    }

    setTimelineWindowEndIndexPreference((currentEndIndex) => {
      const currentWindowEndIndex = Math.min(
        fullTimelineMaxIndex,
        Math.max(
          timelineWindowMinEndIndex,
          currentEndIndex ?? fullTimelineMaxIndex
        )
      );
      const currentWindowStartIndex = Math.max(
        0,
        currentWindowEndIndex - TIMELINE_VISIBLE_MONTH_COUNT + 1
      );
      let nextWindowEndIndex = currentWindowEndIndex;

      if (selectedDateTimelineIndex < currentWindowStartIndex) {
        nextWindowEndIndex = Math.min(
          fullTimelineMaxIndex,
          Math.max(
            timelineWindowMinEndIndex,
            selectedDateTimelineIndex + TIMELINE_VISIBLE_MONTH_COUNT - 1
          )
        );
      } else if (selectedDateTimelineIndex > currentWindowEndIndex) {
        nextWindowEndIndex = Math.min(
          fullTimelineMaxIndex,
          Math.max(timelineWindowMinEndIndex, selectedDateTimelineIndex)
        );
      }

      return nextWindowEndIndex === currentEndIndex ? currentEndIndex : nextWindowEndIndex;
    });
  }, [
    fullTimelineMaxIndex,
    hasDateRange,
    monthlyTimelineDates.length,
    selectedDateTimelineIndex,
    timelineWindowMinEndIndex
  ]);

  useEffect(() => {
    if (!preferencesLoaded || !latestDate) {
      return;
    }

    writePersistedMobilePreferences({
      searchQuery,
      searchTarget,
      selectedDate: activeTileDate || selectedDate,
      visibleLayers
    });
  }, [
    activeTileDate,
    latestDate,
    preferencesLoaded,
    searchQuery,
    searchTarget,
    selectedDate,
    visibleLayers
  ]);

  useEffect(() => {
    if (!selectedDate || !latestDate) {
      return;
    }

    const clampedDate = clampDate(selectedDate, earliestDate, latestDate);
    if (clampedDate !== selectedDate) {
      setTimelinePreviewDate("");
      setSelectedDate(clampedDate);
    }
  }, [earliestDate, latestDate, selectedDate]);

  useEffect(() => {
    if (!searchTarget) {
      return;
    }

    mapRef.current?.animateToRegion(regionForTarget(searchTarget), 900);
  }, [searchTarget]);

  useEffect(() => {
    if (!status.configured || !latestDate) {
      return;
    }

    let ignore = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick(warmNextDate: boolean) {
      const payload = await requestTimelineCacheStatus(warmNextDate);
      if (ignore) {
        return;
      }

      timer = setTimeout(
        () => tick(!payload?.complete),
        payload?.complete
          ? TIMELINE_CACHE_COMPLETE_INTERVAL_MS
          : TIMELINE_CACHE_ACTIVE_INTERVAL_MS
      );
    }

    tick(false);

    return () => {
      ignore = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [latestDate, requestTimelineCacheStatus, status.configured]);

  useEffect(() => {
    if (timelineCacheComplete) {
      timelineCachePulseRef.current.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(timelineCachePulseRef.current, {
          duration: 700,
          toValue: 0.55,
          useNativeDriver: true
        }),
        Animated.timing(timelineCachePulseRef.current, {
          duration: 700,
          toValue: 1,
          useNativeDriver: true
        })
      ])
    );

    animation.start();

    return () => animation.stop();
  }, [timelineCacheComplete]);

  const tileLayers = useMemo(
    () =>
      forestLayerConfigs
        .filter((layer) => visibleLayers[layer.id])
        .map((layer, index) => ({
          ...layer,
          cachePath: activeTileDate ? buildTileCachePath(layer.id, activeTileDate) : undefined,
          opacity: layer.id === "landCover" ? 0.86 : 0.8,
          date: activeTileDate,
          url: activeTileDate ? buildTileUrl(layer.id, activeTileDate) : "",
          zIndex: 20 + index
        })),
    [activeTileDate, visibleLayers]
  );

  useEffect(() => {
    tileLayers.forEach((layer) => {
      if (layer.cachePath) {
        FileSystem.makeDirectoryAsync(layer.cachePath, { intermediates: true }).catch(() => {
          // Native UrlTile still works without a disk cache if the directory cannot be created.
        });
      }
    });
  }, [tileLayers]);

  useEffect(() => {
    if (!activeTileDate || activeLayerLabels.length === 0) {
      setTileLoadStatus("idle");
      return;
    }

    setTileLoadStatus("loading");
    const loadedTimer = setTimeout(() => {
      setTileLoadStatus("loaded");
    }, 2200);

    return () => {
      clearTimeout(loadedTimer);
    };
  }, [activeLayerKey, activeLayerLabels.length, activeTileDate]);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={defaultRegion}
        minZoomLevel={MIN_MAP_ZOOM}
        maxZoomLevel={MAX_MAP_ZOOM}
        onRegionChange={refreshTilesForRegion}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {tileLayers.map(
          (layer) =>
            layer.url && (
              <UrlTile
                key={`${layer.id}-${layer.date}`}
                urlTemplate={layer.url}
                maximumNativeZ={MAX_EARTH_ENGINE_NATIVE_ZOOM}
                maximumZ={MAX_MAP_ZOOM}
                minimumZ={MIN_MAP_ZOOM}
                opacity={layer.opacity}
                shouldReplaceMapContent={false}
                tileCachePath={layer.cachePath}
                tileCacheMaxAge={60 * 60 * 24 * 7}
                tileSize={256}
                zIndex={layer.zIndex}
              />
            )
        )}
      </MapView>

      <View style={styles.searchOverlay}>
        <View style={styles.searchForm}>
          <TextInput
            accessibilityLabel="Search city or state"
            autoCapitalize="words"
            clearButtonMode="while-editing"
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            placeholder="City or state"
            placeholderTextColor="#7f9188"
            returnKeyType="search"
            style={styles.searchInput}
            value={searchQuery}
          />
          <Pressable
            accessibilityLabel="Search map"
            disabled={searchStatus === "loading"}
            onPress={handleSearch}
            style={[styles.searchButton, searchStatus === "loading" && styles.disabledButton]}
          >
            <Text style={styles.searchButtonText}>
              {searchStatus === "loading" ? "..." : "Go"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel={controlsExpanded ? "Hide map legend" : "Show map legend"}
            onPress={() => setControlsExpanded((isExpanded) => !isExpanded)}
            style={styles.panelToggle}
          >
            <Text style={styles.panelToggleText}>{controlsExpanded ? "Hide" : "Layers"}</Text>
          </Pressable>
        </View>
        {searchStatus === "empty" ? (
          <Text style={styles.searchHint}>No matching city or state found.</Text>
        ) : null}
        {searchStatus === "error" ? (
          <Text style={styles.searchHint}>Search is unavailable.</Text>
        ) : null}
        <Text style={styles.tileProgress}>{tileProgressText}</Text>
        {searchResults.length > 1 ? (
          <View style={styles.searchResults}>
            {searchResults.slice(0, 3).map((result) => (
              <Pressable
                key={result.id}
                onPress={() => selectSearchResult(result)}
                style={styles.searchResult}
              >
                <Text style={styles.searchResultText}>{result.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {controlsExpanded ? (
        <View style={styles.controlSheet}>
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.title}>US Dynamic World</Text>
              <Text style={styles.subtitle}>Layers active: {activeCount}</Text>
            </View>
            <Text style={styles.zoomBadge}>
              z{tileZoomLevel}
              {tileZoomLevel > MAX_EARTH_ENGINE_NATIVE_ZOOM
                ? ` / tile z${MAX_EARTH_ENGINE_NATIVE_ZOOM}`
                : ""}
            </Text>
          </View>

          <View style={styles.statusBox}>
            {loadingStatus ? <ActivityIndicator color="#dff2e6" /> : null}
            <Text style={styles.statusText}>{status.message}</Text>
          </View>

          <ScrollView style={styles.layers} contentContainerStyle={styles.layersContent}>
            {forestLayerConfigs.map((layer) => (
              <Pressable
                key={layer.id}
                style={styles.layerItem}
                onPress={() =>
                  setVisibleLayers((prev) => ({
                    ...prev,
                    [layer.id]: !prev[layer.id]
                  }))
                }
              >
                <View style={[styles.swatch, { backgroundColor: layer.color }]} />
                <View style={styles.layerText}>
                  <Text style={styles.layerTitle}>{layer.label}</Text>
                  <Text style={styles.layerDesc}>{layer.description}</Text>
                  <Text style={styles.layerStatus}>
                    {!status.configured
                      ? "Connect Earth Engine"
                      : !selectedDate
                        ? "Reading latest Dynamic World date"
                        : visibleLayers[layer.id]
                          ? tileLoadStatus === "loaded"
                            ? `Earth Engine ${selectedDisplayDate} tiles loaded`
                            : `Queued/rendering Earth Engine ${selectedDisplayDate} tiles`
                          : "Layer off"}
                  </Text>
                </View>
                <Text style={styles.toggle}>{visibleLayers[layer.id] ? "ON" : "OFF"}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.dateBlock}>
            <Text style={styles.dateLabel}>Date</Text>
            <View style={styles.stepper}>
              <Pressable
                accessibilityLabel="Previous Dynamic World month"
                disabled={!canStepBack}
                style={[styles.stepButton, !canStepBack && styles.disabledButton]}
                onPress={() =>
                  updateDate(monthlyTimelineDates[selectedTimelineIndex - 1] ?? selectedDate)
                }
              >
                <Text style={styles.stepButtonText}>-</Text>
              </Pressable>
              <Text style={styles.dateValue}>{selectedDisplayDate}</Text>
              <Pressable
                accessibilityLabel="Next Dynamic World month"
                disabled={!canStepForward}
                style={[styles.stepButton, !canStepForward && styles.disabledButton]}
                onPress={() =>
                  updateDate(monthlyTimelineDates[selectedTimelineIndex + 1] ?? selectedDate)
                }
              >
                <Text style={styles.stepButtonText}>+</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              Slider selects monthly snapshots. Cache warms the visible 12-month window. Tile API:{" "}
              {TILE_API_BASE_URL}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.timelineOverlay}>
        <View style={styles.timelineHeader}>
          <Text style={styles.timelineLabel}>Date</Text>
          <Text style={styles.timelineDate}>{timelineDisplayDate || "Loading"}</Text>
        </View>
        <View style={styles.timelineCacheRow}>
          <Text style={styles.timelineCacheText}>{timelineCacheReadyText}</Text>
          <Text style={styles.timelineCacheText}>{timelineActiveStatusText}</Text>
        </View>
        <View style={styles.timelineWindowRow}>
          <Pressable
            accessibilityLabel="Show previous year of history"
            accessibilityState={{ disabled: !canJumpTimelineBackYear }}
            disabled={!canJumpTimelineBackYear}
            onPress={() => shiftTimelineWindowByYear(-1)}
            style={[
              styles.timelineYearButton,
              !canJumpTimelineBackYear && styles.timelineYearButtonDisabled
            ]}
          >
            <Text style={styles.timelineYearButtonText}>{"< 1Y"}</Text>
          </Pressable>
          <Text style={styles.timelineWindowText}>12 mo window</Text>
          <Pressable
            accessibilityLabel="Show next year of history"
            accessibilityState={{ disabled: !canJumpTimelineForwardYear }}
            disabled={!canJumpTimelineForwardYear}
            onPress={() => shiftTimelineWindowByYear(1)}
            style={[
              styles.timelineYearButton,
              !canJumpTimelineForwardYear && styles.timelineYearButtonDisabled
            ]}
          >
            <Text style={styles.timelineYearButtonText}>{"1Y >"}</Text>
          </Pressable>
        </View>
        {hasDateRange ? (
          <View style={styles.timelineSliderWrap}>
            <View style={styles.timelineSliderTrack}>
              <Animated.View
                style={[
                  styles.timelineReadyTrack,
                  {
                    left: `${Math.min(99.2, Math.max(0, cacheReadyStartPercent))}%`,
                    opacity: timelineCachePulseRef.current
                  }
                ]}
              />
            </View>
            <Slider
              key={`${earliestDate}-${latestDate}`}
              accessibilityLabel="Monthly historical map date"
              disabled={!hasMultipleSelectableTimelineDates}
              lowerLimit={hasMultipleSelectableTimelineDates ? timelineWindowStartIndex : undefined}
              maximumTrackTintColor="transparent"
              maximumValue={effectiveTimelineWindowEndIndex}
              minimumTrackTintColor="transparent"
              minimumValue={timelineWindowStartIndex}
              onSlidingComplete={commitTimelineDate}
              onValueChange={previewTimelineDate}
              step={1}
              style={styles.timelineSlider}
              thumbTintColor="#f6f8f3"
              upperLimit={
                hasMultipleSelectableTimelineDates ? effectiveTimelineWindowEndIndex : undefined
              }
              value={timelineDisplayIndex}
            />
          </View>
        ) : (
          <Slider
            accessibilityLabel="Historical map date loading"
            disabled
            maximumTrackTintColor="#466655"
            maximumValue={1}
            minimumTrackTintColor="#466655"
            minimumValue={0}
            step={1}
            style={styles.timelineSlider}
            thumbTintColor="#92aa9c"
            value={0}
          />
        )}
        <View style={styles.timelineBounds}>
          <Text style={styles.timelineBoundText}>{timelineWindowStartDate}</Text>
          <Text style={styles.timelineBoundText}>{timelineWindowEndDate || "checking"}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0d1f1a"
  },
  searchOverlay: {
    margin: 12,
    marginTop: 24,
    backgroundColor: "rgba(13,31,26,0.86)",
    borderColor: "#355244",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12
  },
  controlSheet: {
    margin: 12,
    marginTop: 0,
    backgroundColor: "rgba(13,31,26,0.86)",
    borderColor: "#355244",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  zoomBadge: {
    backgroundColor: "#eef5ed",
    borderRadius: 6,
    color: "#14231c",
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  title: {
    color: "#f6f8f3",
    fontSize: 20,
    fontWeight: "700"
  },
  subtitle: {
    color: "#b9c9bf",
    marginTop: 4
  },
  searchForm: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  searchInput: {
    backgroundColor: "#eef5ed",
    borderRadius: 6,
    color: "#14231c",
    flex: 1,
    fontSize: 16,
    minHeight: 42,
    paddingHorizontal: 10
  },
  searchButton: {
    alignItems: "center",
    backgroundColor: "#2f8f5b",
    borderRadius: 6,
    height: 42,
    justifyContent: "center",
    width: 56
  },
  searchButtonText: {
    color: "#f6f8f3",
    fontWeight: "800"
  },
  panelToggle: {
    alignItems: "center",
    backgroundColor: "#eef5ed",
    borderRadius: 6,
    height: 42,
    justifyContent: "center",
    paddingHorizontal: 10,
    minWidth: 66
  },
  panelToggleText: {
    color: "#14231c",
    fontSize: 12,
    fontWeight: "800"
  },
  searchHint: {
    color: "#c8d6cd",
    fontSize: 12,
    marginTop: 6
  },
  tileProgress: {
    color: "#b9c9bf",
    fontSize: 10,
    marginTop: 6
  },
  searchResults: {
    borderColor: "#426554",
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 8,
    overflow: "hidden"
  },
  searchResult: {
    borderBottomColor: "#315346",
    borderBottomWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  searchResultText: {
    color: "#f6f8f3",
    fontWeight: "600"
  },
  statusBox: {
    alignItems: "center",
    borderColor: "#426554",
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    padding: 8
  },
  statusText: {
    color: "#dff2e6",
    flex: 1,
    fontSize: 12
  },
  layers: {
    maxHeight: 220,
    marginTop: 12
  },
  layersContent: {
    gap: 8
  },
  layerItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  swatch: {
    borderRadius: 2,
    height: 12,
    width: 12
  },
  layerText: {
    flex: 1
  },
  layerTitle: {
    color: "#f6f8f3",
    fontWeight: "600"
  },
  layerDesc: {
    color: "#b9c9bf",
    fontSize: 12
  },
  layerStatus: {
    color: "#92aa9c",
    fontSize: 10,
    marginTop: 2
  },
  toggle: {
    color: "#9fd5bb",
    fontSize: 12,
    fontWeight: "700"
  },
  dateBlock: {
    marginTop: 12
  },
  dateLabel: {
    color: "#f6f8f3",
    fontWeight: "700",
    marginBottom: 6
  },
  stepper: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  stepButton: {
    alignItems: "center",
    backgroundColor: "#2f8f5b",
    borderRadius: 6,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  disabledButton: {
    backgroundColor: "#6d8175"
  },
  stepButtonText: {
    color: "#f6f8f3",
    fontSize: 24,
    fontWeight: "800"
  },
  dateValue: {
    backgroundColor: "#eef5ed",
    borderRadius: 6,
    color: "#14231c",
    flex: 1,
    fontSize: 18,
    fontWeight: "800",
    paddingHorizontal: 10,
    paddingVertical: 11,
    textAlign: "center"
  },
  hint: {
    color: "#c8d6cd",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8
  },
  timelineOverlay: {
    backgroundColor: "rgba(13,31,26,0.9)",
    borderColor: "#355244",
    borderRadius: 8,
    borderWidth: 1,
    bottom: 12,
    left: 12,
    padding: 12,
    position: "absolute",
    right: 12
  },
  timelineHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  timelineLabel: {
    color: "#c8d6cd",
    fontSize: 12,
    fontWeight: "700"
  },
  timelineDate: {
    color: "#f6f8f3",
    fontSize: 15,
    fontWeight: "800"
  },
  timelineCacheRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8
  },
  timelineCacheText: {
    color: "#b9c9bf",
    fontSize: 10,
    fontWeight: "700"
  },
  timelineWindowRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    marginTop: 8
  },
  timelineYearButton: {
    backgroundColor: "#2f8f5b",
    borderRadius: 6,
    minWidth: 58,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  timelineYearButtonDisabled: {
    backgroundColor: "#466655",
    opacity: 0.46
  },
  timelineYearButtonText: {
    color: "#f6f8f3",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center"
  },
  timelineWindowText: {
    color: "#dce8df",
    flex: 1,
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center"
  },
  timelineSliderWrap: {
    height: 38,
    justifyContent: "center",
    marginTop: 6
  },
  timelineSliderTrack: {
    backgroundColor: "#263d32",
    borderRadius: 999,
    height: 5,
    left: 8,
    overflow: "hidden",
    position: "absolute",
    right: 8
  },
  timelineReadyTrack: {
    backgroundColor: "#76c995",
    borderRadius: 999,
    bottom: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  timelineSlider: {
    height: 38
  },
  timelineBounds: {
    flexDirection: "row",
    justifyContent: "space-between"
  },
  timelineBoundText: {
    color: "#b9c9bf",
    fontSize: 10
  }
});
