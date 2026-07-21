"use client";

import dynamic from "next/dynamic";
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { forestLayerConfigs, type ForestLayerId } from "@forest/shared";
import { type MapTarget } from "@/components/map/MapView";

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
type PersistedPreferences = {
  searchQuery?: string;
  searchTarget?: MapTarget;
  timelineEndDate?: string;
  timelineStartDate?: string;
  visibleLayers?: Partial<Record<ForestLayerId, boolean>>;
};

const DynamicMap = dynamic(() => import("@/components/map/MapView").then((m) => m.MapView), {
  ssr: false
});

const MIN_DYNAMIC_WORLD_DATE = "2015-07-15";
const PREFERENCES_STORAGE_KEY = "oeoc-earth-preferences-v1";
const TIMELINE_STEP_MS = 5000;
const TIMELINE_SLIDER_COMMIT_DELAY_MS = 650;
const TIMELINE_VISIBLE_MONTH_COUNT = 12;
const TIMELINE_YEAR_STEP_MONTHS = 12;
const TIMELINE_CACHE_ACTIVE_INTERVAL_MS = 300;
const TIMELINE_CACHE_COMPLETE_INTERVAL_MS = 15_000;
const HIDDEN_LAYERS: Record<ForestLayerId, boolean> = {
  treeCover: false,
  forestLoss: false,
  landCover: false
};
const LAYER_LEGENDS: Record<
  ForestLayerId,
  { colors: string[]; labels: string[]; variant: "chips" | "ramp" }
> = {
  treeCover: {
    colors: ["#d9f0c2", "#78c679", "#238443", "#004529"],
    labels: ["0.28", "0.9"],
    variant: "ramp"
  },
  forestLoss: {
    colors: ["#fdd49e", "#fc8d59", "#d7301f", "#7f0000"],
    labels: ["0.2 drop", "0.7 drop"],
    variant: "ramp"
  },
  landCover: {
    colors: [
      "#419bdf",
      "#397d49",
      "#88b053",
      "#7a87c6",
      "#e49635",
      "#dfc35a",
      "#c4281b",
      "#a59b8f",
      "#b39fe1"
    ],
    labels: [
      "Water",
      "Trees",
      "Grass",
      "Flooded",
      "Crops",
      "Shrub",
      "Built",
      "Bare",
      "Snow"
    ],
    variant: "chips"
  }
};

function isDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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

function minDate(firstDate: string, secondDate: string) {
  return firstDate <= secondDate ? firstDate : secondDate;
}

function maxDate(firstDate: string, secondDate: string) {
  return firstDate >= secondDate ? firstDate : secondDate;
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

function isSameUtcMonth(firstDate: string, secondDate: string) {
  const first = parseDateValue(firstDate);
  const second = parseDateValue(secondDate);

  return (
    first.getUTCFullYear() === second.getUTCFullYear() &&
    first.getUTCMonth() === second.getUTCMonth()
  );
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

function isMapTarget(value: unknown): value is MapTarget {
  const target = value as Partial<MapTarget>;

  return (
    typeof target?.id === "string" &&
    typeof target.label === "string" &&
    typeof target.lat === "number" &&
    typeof target.lng === "number" &&
    typeof target.zoom === "number" &&
    (target.type === "state" || target.type === "city")
  );
}

function readPersistedPreferences() {
  try {
    const rawPreferences = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!rawPreferences) {
      return {};
    }

    const parsed = JSON.parse(rawPreferences) as PersistedPreferences;

    return {
      searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery : undefined,
      searchTarget: isMapTarget(parsed.searchTarget) ? parsed.searchTarget : undefined,
      timelineEndDate: isDateValue(parsed.timelineEndDate ?? "")
        ? parsed.timelineEndDate
        : undefined,
      timelineStartDate: isDateValue(parsed.timelineStartDate ?? "")
        ? parsed.timelineStartDate
        : undefined,
      visibleLayers: parsed.visibleLayers
    } satisfies PersistedPreferences;
  } catch {
    return {};
  }
}

function writePersistedPreferences(preferences: PersistedPreferences) {
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are helpful but not required for the map to function.
  }
}

export default function HomePage() {
  const [selectedDate, setSelectedDate] = useState("");
  const [timelinePreviewDate, setTimelinePreviewDate] = useState("");
  const [earliestAvailableDate, setEarliestAvailableDate] = useState(MIN_DYNAMIC_WORLD_DATE);
  const [latestAvailableDate, setLatestAvailableDate] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchTarget, setSearchTarget] = useState<MapTarget>();
  const [searchResults, setSearchResults] = useState<MapTarget[]>([]);
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "error" | "empty">("idle");
  const [timelineEnabled, setTimelineEnabled] = useState(false);
  const [timelineLoop, setTimelineLoop] = useState(false);
  const [timelineStartDate, setTimelineStartDate] = useState("");
  const [timelineEndDate, setTimelineEndDate] = useState("");
  const [timelineCacheStatus, setTimelineCacheStatus] = useState<TimelineCacheStatus>();
  const [timelineCacheWarming, setTimelineCacheWarming] = useState(false);
  const [timelineWindowEndIndexPreference, setTimelineWindowEndIndexPreference] =
    useState<number>();
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [dataSourceStatus, setDataSourceStatus] = useState({
    configured: false,
    message: "Checking Google Earth Engine configuration."
  });
  const [visibleLayers, setVisibleLayers] = useState<Record<ForestLayerId, boolean>>({
    treeCover: true,
    forestLoss: true,
    landCover: false
  });
  const [tileStatus, setTileStatus] = useState<
    Partial<Record<ForestLayerId, { loaded: number; error: number }>>
  >({});
  const timelineCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasLatestAvailableDate = Boolean(latestAvailableDate);
  const availableTimelineDates = useMemo(
    () =>
      latestAvailableDate
        ? buildMonthlyTimelineDates(earliestAvailableDate, latestAvailableDate)
        : [],
    [earliestAvailableDate, latestAvailableDate]
  );
  const oldestTimelineDate = availableTimelineDates[0] ?? earliestAvailableDate;
  const latestTimelineDate =
    availableTimelineDates.at(-1) ?? latestAvailableDate ?? earliestAvailableDate;
  const configuredStartDate = timelineStartDate
    ? clampDate(timelineStartDate, oldestTimelineDate, latestTimelineDate)
    : oldestTimelineDate;
  const configuredEndDate = timelineEndDate
    ? clampDate(timelineEndDate, oldestTimelineDate, latestTimelineDate)
    : latestTimelineDate;
  const rangeStartDate = useMemo(
    () => minDate(configuredStartDate, configuredEndDate),
    [configuredEndDate, configuredStartDate]
  );
  const rangeEndDate = useMemo(
    () => maxDate(configuredStartDate, configuredEndDate),
    [configuredEndDate, configuredStartDate]
  );
  const selectedDisplayDate = selectedDate
    ? clampDate(selectedDate, rangeStartDate, rangeEndDate)
    : hasLatestAvailableDate
      ? rangeEndDate
      : "";
  const monthlyTimelineDates = useMemo(
    () => buildMonthlyTimelineDates(rangeStartDate, rangeEndDate),
    [rangeEndDate, rangeStartDate]
  );
  const fullTimelineMaxIndex = Math.max(0, monthlyTimelineDates.length - 1);
  const timelineLayerIds = useMemo(() => {
    const selectedLayerIds = forestLayerConfigs
      .filter((layer) => visibleLayers[layer.id])
      .map((layer) => layer.id);

    return selectedLayerIds.length > 0 ? selectedLayerIds : (["treeCover"] as ForestLayerId[]);
  }, [visibleLayers]);
  const selectedDateTimelineIndex = useMemo(
    () => nearestDateIndex(monthlyTimelineDates, selectedDate || rangeEndDate),
    [monthlyTimelineDates, rangeEndDate, selectedDate]
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
  const timelineWindowStartDate =
    monthlyTimelineDates[timelineWindowStartIndex] ?? rangeStartDate;
  const timelineWindowEndDate =
    monthlyTimelineDates[effectiveTimelineWindowEndIndex] ?? rangeEndDate;
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
  const cachedTimelineMaxIndex = Math.max(0, cachedTimelineDates.length - 1);
  const cachedRangeStartDate = cachedTimelineDates[0] ?? rangeEndDate;
  const cachedRangeEndDate = cachedTimelineDates[cachedTimelineMaxIndex] ?? rangeEndDate;
  const hasMultipleCachedTimelineDates = cachedTimelineDates.length > 1;
  const activeMapDate = timelinePreviewDate
    ? clampDate(timelinePreviewDate, rangeStartDate, rangeEndDate)
    : selectedDisplayDate;
  const timelineDisplayDate = activeMapDate;
  const timelineDisplayDateIndex = useMemo(
    () =>
      Math.max(
        timelineWindowStartIndex,
        Math.min(effectiveTimelineWindowEndIndex, nearestDateIndex(monthlyTimelineDates, activeMapDate))
      ),
    [
      activeMapDate,
      effectiveTimelineWindowEndIndex,
      monthlyTimelineDates,
      timelineWindowStartIndex
    ]
  );
  const selectedTimelineIndex = useMemo(
    () => nearestDateIndex(monthlyTimelineDates, activeMapDate),
    [activeMapDate, monthlyTimelineDates]
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
  const timelineSliderStyle = {
    "--cache-ready-start": `${Math.min(99.2, Math.max(0, cacheReadyStartPercent))}%`
  } as CSSProperties;
  const hasMultipleSelectableTimelineDates = Boolean(
    hasLatestAvailableDate && timelineWindowStartIndex < effectiveTimelineWindowEndIndex
  );
  const previousTimelineWindowEndIndex =
    effectiveTimelineWindowEndIndex - TIMELINE_YEAR_STEP_MONTHS;
  const nextTimelineWindowEndIndex =
    effectiveTimelineWindowEndIndex + TIMELINE_YEAR_STEP_MONTHS;
  const canJumpTimelineBackYear = Boolean(
    hasLatestAvailableDate && previousTimelineWindowEndIndex >= timelineWindowMinEndIndex
  );
  const canJumpTimelineForwardYear = Boolean(
    hasLatestAvailableDate && nextTimelineWindowEndIndex <= fullTimelineMaxIndex
  );
  const timelineCacheComplete = Boolean(timelineCacheStatus?.complete);
  const timelineCacheReadyText = timelineCacheStatus
    ? `${timelineCacheStatus.readyCount}/${timelineCacheStatus.totalCount} months ready`
    : "Checking cached months";
  const activeCount = useMemo(
    () => Object.values(visibleLayers).filter(Boolean).length,
    [visibleLayers]
  );
  const renderedLayers = useMemo(
    () =>
      dataSourceStatus.configured && hasLatestAvailableDate && selectedDate
        ? visibleLayers
        : HIDDEN_LAYERS,
    [dataSourceStatus.configured, hasLatestAvailableDate, selectedDate, visibleLayers]
  );
  const activeTimelineDateReady = Boolean(
    activeMapDate &&
      (timelineCacheStatus?.readyDates.includes(activeMapDate) ||
        timelineCacheStatus?.enabledDates.includes(activeMapDate) ||
        timelineLayerIds.every((layerId) => (tileStatus[layerId]?.loaded ?? 0) > 0))
  );
  const timelineActiveStatusText = activeTimelineDateReady
    ? "ready"
    : timelineCacheWarming
      ? "warming"
      : "checking";

  const updateSelectedDate = useCallback(
    (nextDate: string) => {
      if (!hasLatestAvailableDate || !isDateValue(nextDate)) {
        return;
      }

      setTimelinePreviewDate("");
      setTileStatus({});
      const clampedDate = clampDate(nextDate, rangeStartDate, rangeEndDate);
      setSelectedDate(
        monthlyTimelineDates[nearestDateIndex(monthlyTimelineDates, clampedDate)] ?? rangeEndDate
      );
    },
    [
      hasLatestAvailableDate,
      monthlyTimelineDates,
      rangeEndDate,
      rangeStartDate
    ]
  );
  const clearTimelineCommitTimer = useCallback(() => {
    if (timelineCommitTimerRef.current) {
      clearTimeout(timelineCommitTimerRef.current);
      timelineCommitTimerRef.current = null;
    }
  }, []);
  const commitTimelineDate = useCallback(
    (nextDate: string) => {
      clearTimelineCommitTimer();
      updateSelectedDate(nextDate);
    },
    [clearTimelineCommitTimer, updateSelectedDate]
  );
  const previewTimelineDate = useCallback(
    (nextDate: string) => {
      if (!hasLatestAvailableDate || !isDateValue(nextDate)) {
        return;
      }

      const clampedDate = clampDate(nextDate, rangeStartDate, rangeEndDate);
      setTimelinePreviewDate(clampedDate);
      setTileStatus({});
      clearTimelineCommitTimer();
      timelineCommitTimerRef.current = setTimeout(() => {
        commitTimelineDate(clampedDate);
      }, TIMELINE_SLIDER_COMMIT_DELAY_MS);
    },
    [
      clearTimelineCommitTimer,
      commitTimelineDate,
      hasLatestAvailableDate,
      rangeEndDate,
      rangeStartDate
    ]
  );
  const shiftTimelineWindowByYear = useCallback(
    (direction: -1 | 1) => {
      if (!hasLatestAvailableDate || monthlyTimelineDates.length === 0) {
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
      setTileStatus({});
      setSelectedDate(monthlyTimelineDates[nextWindowEndIndex] ?? timelineWindowEndDate);
    },
    [
      canJumpTimelineBackYear,
      canJumpTimelineForwardYear,
      hasLatestAvailableDate,
      monthlyTimelineDates,
      nextTimelineWindowEndIndex,
      previousTimelineWindowEndIndex,
      timelineWindowEndDate
    ]
  );
  const handleTileStatus = useCallback(
    (layerId: ForestLayerId, status: "loaded" | "error") => {
      setTileStatus((prev) => {
        const current = prev[layerId] ?? { loaded: 0, error: 0 };
        return {
          ...prev,
          [layerId]: {
            ...current,
            [status]: current[status] + 1
          }
        };
      });
    },
    []
  );
  const selectSearchResult = useCallback((result: MapTarget) => {
    setSearchTarget(result);
    setSearchQuery(result.label);
    setSearchStatus("idle");
    setTileStatus({});
  }, []);
  const updateTimelineStartDate = useCallback(
    (nextDate: string) => {
      if (!isDateValue(nextDate)) {
        return;
      }

      const clampedDate = clampDate(nextDate, oldestTimelineDate, latestTimelineDate);
      setTimelineStartDate(clampedDate);
      setTimelineEndDate((currentEndDate) =>
        currentEndDate && currentEndDate >= clampedDate ? currentEndDate : clampedDate
      );
    },
    [latestTimelineDate, oldestTimelineDate]
  );
  const updateTimelineEndDate = useCallback(
    (nextDate: string) => {
      if (!isDateValue(nextDate)) {
        return;
      }

      const clampedDate = clampDate(nextDate, oldestTimelineDate, latestTimelineDate);
      setTimelineEndDate(clampedDate);
      setTimelineStartDate((currentStartDate) =>
        currentStartDate && currentStartDate <= clampedDate ? currentStartDate : clampedDate
      );
    },
    [latestTimelineDate, oldestTimelineDate]
  );
  const toggleTimeline = useCallback(
    (enabled: boolean) => {
      setTimelineEnabled(enabled);

      if (enabled && hasLatestAvailableDate) {
        updateSelectedDate(cachedTimelineDates[0] ?? cachedRangeStartDate);
      }
    },
    [cachedRangeStartDate, cachedTimelineDates, hasLatestAvailableDate, updateSelectedDate]
  );
  const handleSearch = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const query = searchQuery.trim();
      if (!query) {
        setSearchResults([]);
        setSearchStatus("empty");
        return;
      }

      setSearchStatus("loading");

      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) {
          throw new Error("Search failed");
        }

        const payload = (await response.json()) as { results?: MapTarget[] };
        const results = payload.results ?? [];
        setSearchResults(results);

        if (results.length === 0) {
          setSearchStatus("empty");
          return;
        }

        selectSearchResult(results[0]);
      } catch {
        setSearchResults([]);
        setSearchStatus("error");
      }
    },
    [searchQuery, selectSearchResult]
  );
  const requestTimelineCacheStatus = useCallback(
    async (warmNextDate: boolean) => {
      if (!dataSourceStatus.configured || !hasLatestAvailableDate) {
        return undefined;
      }

      const searchParams = new URLSearchParams({
        endDate: timelineWindowEndDate,
        layers: timelineLayerIds.join(","),
        startDate: timelineWindowStartDate
      });
      setTimelineCacheWarming(warmNextDate);

      try {
        const response = await fetch(`/api/earth-engine/timeline-cache?${searchParams}`, {
          method: warmNextDate ? "POST" : "GET"
        });
        if (!response.ok && response.status !== 202) {
          throw new Error("Timeline cache status failed.");
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
    [
      dataSourceStatus.configured,
      hasLatestAvailableDate,
      timelineLayerIds,
      timelineWindowEndDate,
      timelineWindowStartDate
    ]
  );

  useEffect(() => {
    const preferences = readPersistedPreferences();

    if (preferences.searchQuery) {
      setSearchQuery(preferences.searchQuery);
    }
    if (preferences.searchTarget) {
      setSearchTarget(preferences.searchTarget);
    }
    if (preferences.timelineStartDate) {
      setTimelineStartDate(preferences.timelineStartDate);
    }
    if (preferences.timelineEndDate) {
      setTimelineEndDate(preferences.timelineEndDate);
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
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadDataSourceStatus() {
      try {
        const response = await fetch("/api/earth-engine/status");
        if (!response.ok) {
          throw new Error("Unable to read Earth Engine status.");
        }
        const payload = (await response.json()) as {
          configured: boolean;
          minDate?: string;
          latestAvailableDate?: string;
          message: string;
        };

        if (!ignore) {
          const earliestDate =
            payload.minDate && isDateValue(payload.minDate)
              ? payload.minDate
              : MIN_DYNAMIC_WORLD_DATE;
          const latestDate =
            payload.latestAvailableDate && isDateValue(payload.latestAvailableDate)
              ? payload.latestAvailableDate
              : "";

          setDataSourceStatus({
            configured: payload.configured,
            message:
              payload.configured && !latestDate
                ? "Google Earth Engine is configured, but the latest Dynamic World data date is still unavailable."
                : payload.message
          });

          setEarliestAvailableDate(earliestDate);
          setLatestAvailableDate(latestDate);
        }
      } catch {
        if (!ignore) {
          setDataSourceStatus({
            configured: false,
            message: "Unable to verify Google Earth Engine configuration."
          });
        }
      }
    }

    loadDataSourceStatus();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    return () => clearTimelineCommitTimer();
  }, [clearTimelineCommitTimer]);

  useEffect(() => {
    if (!hasLatestAvailableDate || monthlyTimelineDates.length === 0) {
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
    hasLatestAvailableDate,
    monthlyTimelineDates.length,
    selectedDateTimelineIndex,
    timelineWindowMinEndIndex
  ]);

  useEffect(() => {
    if (!preferencesLoaded || !hasLatestAvailableDate) {
      return;
    }

    writePersistedPreferences({
      searchQuery,
      searchTarget,
      timelineEndDate: rangeEndDate,
      timelineStartDate: rangeStartDate,
      visibleLayers
    });
  }, [
    hasLatestAvailableDate,
    preferencesLoaded,
    rangeEndDate,
    rangeStartDate,
    searchQuery,
    searchTarget,
    visibleLayers
  ]);

  useEffect(() => {
    if (!latestAvailableDate) {
      return;
    }

    setSelectedDate((currentDate) => {
      const nextDate = currentDate
        ? clampDate(currentDate, rangeStartDate, rangeEndDate)
        : clampDate(latestAvailableDate, rangeStartDate, rangeEndDate);

      return nextDate === currentDate ? currentDate : nextDate;
    });
  }, [latestAvailableDate, rangeEndDate, rangeStartDate]);

  useEffect(() => {
    if (!dataSourceStatus.configured || !hasLatestAvailableDate) {
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
  }, [
    dataSourceStatus.configured,
    hasLatestAvailableDate,
    requestTimelineCacheStatus
  ]);

  useEffect(() => {
    if (!timelineEnabled || !selectedDate) {
      return;
    }

    const clampedDate = clampDate(selectedDate, cachedRangeStartDate, cachedRangeEndDate);
    if (clampedDate !== selectedDate) {
      updateSelectedDate(clampedDate);
      return;
    }

    const stepTimer = setTimeout(() => {
      const nextTimelineIndex = cachedTimelineDates.findIndex(
        (timelineDate) => timelineDate > selectedDate
      );

      if (nextTimelineIndex === -1) {
        if (timelineLoop) {
          updateSelectedDate(cachedTimelineDates[0] ?? cachedRangeStartDate);
        } else {
          setTimelineEnabled(false);
        }
        return;
      }

      updateSelectedDate(cachedTimelineDates[nextTimelineIndex]);
    }, TIMELINE_STEP_MS);

    return () => clearTimeout(stepTimer);
  }, [
    cachedRangeEndDate,
    cachedRangeStartDate,
    cachedTimelineDates,
    selectedDate,
    timelineEnabled,
    timelineLoop,
    updateSelectedDate
  ]);

  return (
    <main className="shell">
      <header className="topBar">
        <div>
          <p className="kicker">Prototype</p>
          <h1>US Dynamic World Land Cover Explorer</h1>
        </div>
        <p className="meta">Layers active: {activeCount}</p>
      </header>

      <section className="content">
        <aside className="panel">
          <section className="searchBlock">
            <h2>Search</h2>
            <form className="searchForm" onSubmit={handleSearch}>
              <input
                type="search"
                value={searchQuery}
                placeholder="City, state, or state abbreviation"
                onChange={(event) => setSearchQuery(event.target.value)}
                aria-label="Search city or state"
              />
              <button type="submit" disabled={searchStatus === "loading"}>
                {searchStatus === "loading" ? "Searching" : "Go"}
              </button>
            </form>
            {searchTarget && (
              <p className="searchMeta">
                Viewing {searchTarget.label} at zoom {searchTarget.zoom}
              </p>
            )}
            {searchStatus === "empty" && (
              <p className="searchMeta">No U.S. city or state match found.</p>
            )}
            {searchStatus === "error" && (
              <p className="searchMeta">Search is unavailable right now.</p>
            )}
            {searchResults.length > 1 && (
              <div className="resultList">
                {searchResults.slice(0, 4).map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    className="resultButton"
                    onClick={() => selectSearchResult(result)}
                  >
                    {result.label}
                  </button>
                ))}
              </div>
            )}
          </section>

          <h2>Map Layers</h2>
          <p className={dataSourceStatus.configured ? "dataSourceNote" : "dataSourceNote warning"}>
            {dataSourceStatus.message}
          </p>
          {dataSourceStatus.configured && (
            <p className="dataSourceNote">
              Visible Dynamic World tiles load first; background preloads are throttled.
            </p>
          )}
          <div className="layerGroup">
            {forestLayerConfigs.map((layer) => (
              <label className="layerRow" key={layer.id}>
                <input
                  type="checkbox"
                  aria-label={layer.label}
                  autoComplete="off"
                  data-layer-id={layer.id}
                  checked={visibleLayers[layer.id]}
                  onChange={(event) => {
                    setTileStatus((prev) => ({
                      ...prev,
                      [layer.id]: { loaded: 0, error: 0 }
                    }));
                    setVisibleLayers((prev) => ({
                      ...prev,
                      [layer.id]: event.target.checked
                    }));
                  }}
                />
                <span
                  className="layerSwatch"
                  style={{
                    background: `linear-gradient(90deg, ${LAYER_LEGENDS[layer.id].colors.join(", ")})`
                  }}
                />
                <span>
                  <strong>{layer.label}</strong>
                  <small>{layer.description}</small>
                  <span
                    className={
                      LAYER_LEGENDS[layer.id].variant === "chips"
                        ? "layerLegend chipLegend"
                        : "layerLegend rampLegend"
                    }
                    aria-label={`${layer.label} legend`}
                  >
                    {LAYER_LEGENDS[layer.id].variant === "ramp" ? (
                      <>
                        <span
                          className="legendRamp"
                          style={{
                            background: `linear-gradient(90deg, ${LAYER_LEGENDS[
                              layer.id
                            ].colors.join(", ")})`
                          }}
                        />
                        <span className="legendScale">
                          <span>{LAYER_LEGENDS[layer.id].labels[0]}</span>
                          <span>{LAYER_LEGENDS[layer.id].labels[1]}</span>
                        </span>
                      </>
                    ) : (
                      LAYER_LEGENDS[layer.id].colors.map((color, index) => (
                        <span className="legendChip" key={`${layer.id}-${color}`}>
                          <span className="legendDot" style={{ background: color }} />
                          <span>{LAYER_LEGENDS[layer.id].labels[index]}</span>
                        </span>
                      ))
                    )}
                  </span>
                  <small className="statusLine">
                    {tileStatus[layer.id]?.loaded
                      ? `${tileStatus[layer.id]?.loaded} Earth Engine ${activeMapDate} tiles loaded`
                      : !dataSourceStatus.configured
                        ? "Connect Earth Engine"
                        : !selectedDate
                          ? "Reading latest Dynamic World date"
                          : visibleLayers[layer.id]
                            ? `Queued/rendering Earth Engine ${activeMapDate} tiles`
                            : "Layer off"}
                    {tileStatus[layer.id]?.error ? ` / ${tileStatus[layer.id]?.error} errors` : ""}
                  </small>
                </span>
              </label>
            ))}
          </div>

          <div className="yearControl">
            <div className="yearHeader">
              <label htmlFor="dateSelect">Date</label>
              <select
                id="dateSelect"
                aria-label="Date"
                value={activeMapDate}
                disabled={!hasLatestAvailableDate || !selectedDate}
                onChange={(event) => updateSelectedDate(event.currentTarget.value)}
              >
                {monthlyTimelineDates.map((availableDate, index) => (
                  <option key={availableDate} value={availableDate}>
                    {availableDate}
                    {index === 0 ? " (oldest)" : ""}
                    {index === fullTimelineMaxIndex ? " (latest)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="yearStepper" aria-label="Step Dynamic World date">
              <button
                type="button"
                className="yearStepButton"
                aria-label="Previous Dynamic World month"
                disabled={
                  !hasLatestAvailableDate || !selectedDate || selectedTimelineIndex <= 0
                }
                onClick={() =>
                  updateSelectedDate(
                    monthlyTimelineDates[selectedTimelineIndex - 1] ?? rangeStartDate
                  )
                }
              >
                -
              </button>
              <output className="yearReadout dateReadout" aria-live="polite">
                {selectedDate ? activeMapDate : "Loading"}
              </output>
              <button
                type="button"
                className="yearStepButton"
                aria-label="Next Dynamic World month"
                disabled={
                  !hasLatestAvailableDate ||
                  !selectedDate ||
                  selectedTimelineIndex >= fullTimelineMaxIndex
                }
                onClick={() =>
                  updateSelectedDate(
                    monthlyTimelineDates[selectedTimelineIndex + 1] ?? rangeEndDate
                  )
                }
              >
                +
              </button>
            </div>
            <p className="hint">
              Monthly Dynamic World V1 30-day mosaics. Slider selects available data; cache warms
              the visible 12-month window. Latest available:{" "}
              {latestAvailableDate || "checking Earth Engine"}. Earliest available:{" "}
              {earliestAvailableDate}.
            </p>
            <div className="timelinePanel">
              <div className="timelineCacheHeader" aria-live="polite">
                <span>History cache</span>
                <strong>
                  {timelineCacheReadyText}
                  {timelineCacheComplete ? "" : timelineCacheWarming ? " / warming" : " / checking"}
                </strong>
              </div>
              <label className="timelineToggle">
                <input
                  type="checkbox"
                  checked={timelineEnabled}
                  disabled={
                    !hasLatestAvailableDate || !selectedDate || !hasMultipleCachedTimelineDates
                  }
                  onChange={(event) => toggleTimeline(event.currentTarget.checked)}
                />
                <span>Animate timeline</span>
              </label>
              <label className="timelineToggle">
                <input
                  type="checkbox"
                  checked={timelineLoop}
                  disabled={!hasLatestAvailableDate || !selectedDate}
                  onChange={(event) => setTimelineLoop(event.currentTarget.checked)}
                />
                <span>Loop range</span>
              </label>
              <div className="timelineRange">
                <label htmlFor="timelineStartDate">
                  <span>Start date</span>
                  <select
                    id="timelineStartDate"
                    aria-label="Timeline start date"
                    disabled={!hasLatestAvailableDate}
                    value={rangeStartDate}
                    onChange={(event) => updateTimelineStartDate(event.currentTarget.value)}
                  >
                    {availableTimelineDates.map((availableDate, index) => (
                      <option key={availableDate} value={availableDate}>
                        {availableDate}
                        {index === 0 ? " (oldest)" : ""}
                        {availableDate === latestTimelineDate ? " (latest)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="timelineEndDate">
                  <span>End date</span>
                  <select
                    id="timelineEndDate"
                    aria-label="Timeline end date"
                    disabled={!hasLatestAvailableDate}
                    value={rangeEndDate}
                    onChange={(event) => updateTimelineEndDate(event.currentTarget.value)}
                  >
                    {availableTimelineDates.map((availableDate, index) => (
                      <option key={availableDate} value={availableDate}>
                        {availableDate}
                        {index === 0 ? " (oldest)" : ""}
                        {availableDate === latestTimelineDate ? " (latest)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="hint">Plays oldest to newest at 5 seconds per month.</p>
            </div>
          </div>
        </aside>

        <div className="mapWrap">
          <DynamicMap
            visibleLayers={renderedLayers}
            target={searchTarget}
            date={activeMapDate || earliestAvailableDate}
            preloadMaxDate={timelineWindowEndDate}
            preloadMinDate={timelineWindowStartDate}
            onTileStatus={handleTileStatus}
          />
          <div className="dayTimeline">
            <div className="dayTimelineHeader">
              <span>{timelineWindowStartDate}</span>
              <strong>{selectedDate ? timelineDisplayDate : "Loading latest date"}</strong>
              <span>{timelineWindowEndDate}</span>
            </div>
            <p className="dayTimelineCache" aria-live="polite">
              {timelineCacheReadyText}
              {` / ${timelineActiveStatusText}`}
            </p>
            <div className="dayTimelineWindow">
              <button
                type="button"
                disabled={!canJumpTimelineBackYear}
                onClick={() => shiftTimelineWindowByYear(-1)}
              >
                &lt; 1Y
              </button>
              <span>12 mo window</span>
              <button
                type="button"
                disabled={!canJumpTimelineForwardYear}
                onClick={() => shiftTimelineWindowByYear(1)}
              >
                1Y &gt;
              </button>
            </div>
            <input
              className={timelineCacheComplete ? "ready" : "warming"}
              type="range"
              min={timelineWindowStartIndex}
              max={effectiveTimelineWindowEndIndex}
              step={1}
              style={timelineSliderStyle}
              value={timelineDisplayDateIndex}
              disabled={
                !hasLatestAvailableDate || !selectedDate || !hasMultipleSelectableTimelineDates
              }
              aria-label="Monthly Dynamic World timeline"
              onChange={(event) =>
                previewTimelineDate(
                  monthlyTimelineDates[Number(event.currentTarget.value)] ?? timelineWindowEndDate
                )
              }
              onBlur={(event) =>
                commitTimelineDate(
                  monthlyTimelineDates[Number(event.currentTarget.value)] ?? timelineWindowEndDate
                )
              }
              onKeyUp={(event) =>
                commitTimelineDate(
                  monthlyTimelineDates[Number(event.currentTarget.value)] ?? timelineWindowEndDate
                )
              }
              onPointerUp={(event) =>
                commitTimelineDate(
                  monthlyTimelineDates[Number(event.currentTarget.value)] ?? timelineWindowEndDate
                )
              }
            />
          </div>
        </div>
      </section>
    </main>
  );
}
