"use client";

import dynamic from "next/dynamic";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { forestLayerConfigs, type ForestLayerId } from "@forest/shared";
import { type MapTarget } from "@/components/map/MapView";

const DynamicMap = dynamic(() => import("@/components/map/MapView").then((m) => m.MapView), {
  ssr: false
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_DYNAMIC_WORLD_DATE = "2015-07-15";
const MIN_DYNAMIC_WORLD_YEAR = 2015;
const MAX_DYNAMIC_WORLD_YEAR = new Date().getFullYear();
const TIMELINE_STEP_MS = 5000;
const TIMELINE_SLIDER_COMMIT_DELAY_MS = 650;
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

function addDays(value: string, days: number) {
  const date = parseDateValue(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateValue(date);
}

function daysBetween(startDate: string, endDate: string) {
  const start = parseDateValue(startDate).getTime();
  const end = parseDateValue(endDate).getTime();
  return Math.max(0, Math.round((end - start) / MS_PER_DAY));
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

function dateFromYearStart(year: number, minimumDate: string) {
  return maxDate(`${year}-01-01`, minimumDate);
}

function dateFromYearEnd(year: number) {
  return `${year}-12-31`;
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
  const [timelineMinYear, setTimelineMinYear] = useState(MIN_DYNAMIC_WORLD_YEAR);
  const [timelineMaxYear, setTimelineMaxYear] = useState(MAX_DYNAMIC_WORLD_YEAR);
  const [dataSourceStatus, setDataSourceStatus] = useState({
    configured: false,
    message: "Checking Google Earth Engine configuration."
  });
  const [visibleLayers, setVisibleLayers] = useState<Record<ForestLayerId, boolean>>({
    treeCover: true,
    forestLoss: false,
    landCover: true
  });
  const [tileStatus, setTileStatus] = useState<
    Partial<Record<ForestLayerId, { loaded: number; error: number }>>
  >({});
  const timelineCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasLatestAvailableDate = Boolean(latestAvailableDate);
  const availableMinYear = useMemo(
    () => parseDateValue(earliestAvailableDate).getUTCFullYear(),
    [earliestAvailableDate]
  );
  const dynamicWorldYearsAsc = useMemo(
    () =>
      Array.from(
        { length: MAX_DYNAMIC_WORLD_YEAR - availableMinYear + 1 },
        (_, index) => availableMinYear + index
      ),
    [availableMinYear]
  );
  const rangeStartCandidate = useMemo(
    () => dateFromYearStart(Math.min(timelineMinYear, timelineMaxYear), earliestAvailableDate),
    [earliestAvailableDate, timelineMaxYear, timelineMinYear]
  );
  const rangeEndDate = useMemo(
    () =>
      latestAvailableDate
        ? minDate(dateFromYearEnd(Math.max(timelineMinYear, timelineMaxYear)), latestAvailableDate)
        : earliestAvailableDate,
    [earliestAvailableDate, latestAvailableDate, timelineMaxYear, timelineMinYear]
  );
  const rangeStartDate = useMemo(
    () => (rangeEndDate < rangeStartCandidate ? rangeEndDate : rangeStartCandidate),
    [rangeEndDate, rangeStartCandidate]
  );
  const selectedDisplayDate = selectedDate
    ? clampDate(selectedDate, rangeStartDate, rangeEndDate)
    : hasLatestAvailableDate
      ? rangeEndDate
      : "";
  const timelineDayCount = useMemo(
    () => daysBetween(rangeStartDate, rangeEndDate),
    [rangeEndDate, rangeStartDate]
  );
  const timelineDisplayDate = timelinePreviewDate
    ? clampDate(timelinePreviewDate, rangeStartDate, rangeEndDate)
    : selectedDisplayDate;
  const timelineDisplayDateIndex = useMemo(
    () =>
      timelineDisplayDate
        ? Math.min(timelineDayCount, daysBetween(rangeStartDate, timelineDisplayDate))
        : 0,
    [rangeStartDate, timelineDayCount, timelineDisplayDate]
  );
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

  const updateSelectedDate = useCallback(
    (nextDate: string) => {
      if (!hasLatestAvailableDate || !isDateValue(nextDate)) {
        return;
      }

      setTimelinePreviewDate("");
      setTileStatus({});
      setSelectedDate(clampDate(nextDate, rangeStartDate, rangeEndDate));
    },
    [hasLatestAvailableDate, rangeEndDate, rangeStartDate]
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
    setSearchStatus("idle");
    setTileStatus({});
  }, []);
  const updateTimelineMinYear = useCallback((nextYear: number) => {
    const clampedYear = Math.min(
      MAX_DYNAMIC_WORLD_YEAR,
      Math.max(availableMinYear, nextYear)
    );
    setTimelineMinYear(clampedYear);
    setTimelineMaxYear((currentMaxYear) => Math.max(currentMaxYear, clampedYear));
  }, [availableMinYear]);
  const updateTimelineMaxYear = useCallback((nextYear: number) => {
    const clampedYear = Math.min(
      MAX_DYNAMIC_WORLD_YEAR,
      Math.max(availableMinYear, nextYear)
    );
    setTimelineMaxYear(clampedYear);
    setTimelineMinYear((currentMinYear) => Math.min(currentMinYear, clampedYear));
  }, [availableMinYear]);
  const toggleTimeline = useCallback(
    (enabled: boolean) => {
      setTimelineEnabled(enabled);

      if (enabled && hasLatestAvailableDate) {
        updateSelectedDate(rangeStartDate);
      }
    },
    [hasLatestAvailableDate, rangeStartDate, updateSelectedDate]
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
          setTimelineMinYear((currentMinYear) =>
            Math.max(currentMinYear, parseDateValue(earliestDate).getUTCFullYear())
          );
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
    if (!timelineEnabled || !selectedDate) {
      return;
    }

    const clampedDate = clampDate(selectedDate, rangeStartDate, rangeEndDate);
    if (clampedDate !== selectedDate) {
      updateSelectedDate(clampedDate);
      return;
    }

    const stepTimer = setTimeout(() => {
      if (selectedDate >= rangeEndDate) {
        if (timelineLoop) {
          updateSelectedDate(rangeStartDate);
        } else {
          setTimelineEnabled(false);
        }
        return;
      }

      updateSelectedDate(addDays(selectedDate, 1));
    }, TIMELINE_STEP_MS);

    return () => clearTimeout(stepTimer);
  }, [
    rangeEndDate,
    rangeStartDate,
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
                      ? `${tileStatus[layer.id]?.loaded} Earth Engine ${selectedDisplayDate} tiles loaded`
                      : !dataSourceStatus.configured
                        ? "Connect Earth Engine"
                        : !selectedDate
                          ? "Reading latest Dynamic World date"
                          : visibleLayers[layer.id]
                            ? `Queued/rendering Earth Engine ${selectedDisplayDate} tiles`
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
              <input
                id="dateSelect"
                type="date"
                aria-label="Date"
                min={rangeStartDate}
                max={rangeEndDate}
                value={selectedDisplayDate}
                disabled={!hasLatestAvailableDate || !selectedDate}
                onChange={(event) => updateSelectedDate(event.currentTarget.value)}
              />
            </div>
            <div className="yearStepper" aria-label="Step Dynamic World date">
              <button
                type="button"
                className="yearStepButton"
                aria-label="Previous Dynamic World day"
                disabled={
                  !hasLatestAvailableDate || !selectedDate || selectedDisplayDate <= rangeStartDate
                }
                onClick={() => updateSelectedDate(addDays(selectedDisplayDate, -1))}
              >
                -
              </button>
              <output className="yearReadout dateReadout" aria-live="polite">
                {selectedDate ? selectedDisplayDate : "Loading"}
              </output>
              <button
                type="button"
                className="yearStepButton"
                aria-label="Next Dynamic World day"
                disabled={
                  !hasLatestAvailableDate || !selectedDate || selectedDisplayDate >= rangeEndDate
                }
                onClick={() => updateSelectedDate(addDays(selectedDisplayDate, 1))}
              >
                +
              </button>
            </div>
            <p className="hint">
              Dynamic World V1 30-day mosaic ending on the selected date. Latest available:{" "}
              {latestAvailableDate || "checking Earth Engine"}. Earliest available:{" "}
              {earliestAvailableDate}. First tiles can take up to 60 seconds.
            </p>
            <div className="timelinePanel">
              <label className="timelineToggle">
                <input
                  type="checkbox"
                  checked={timelineEnabled}
                  disabled={!hasLatestAvailableDate || !selectedDate}
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
                <label htmlFor="timelineMinYear">
                  <span>Start year</span>
                  <select
                    id="timelineMinYear"
                    aria-label="Timeline start year"
                    value={timelineMinYear}
                    onChange={(event) => updateTimelineMinYear(Number(event.currentTarget.value))}
                  >
                    {dynamicWorldYearsAsc.map((availableYear) => (
                      <option key={availableYear} value={availableYear}>
                        {availableYear}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="timelineMaxYear">
                  <span>End year</span>
                  <select
                    id="timelineMaxYear"
                    aria-label="Timeline end year"
                    value={timelineMaxYear}
                    onChange={(event) => updateTimelineMaxYear(Number(event.currentTarget.value))}
                  >
                    {dynamicWorldYearsAsc.map((availableYear) => (
                      <option key={availableYear} value={availableYear}>
                        {availableYear}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="hint">Plays oldest to newest at 5 seconds per day.</p>
            </div>
          </div>
        </aside>

        <div className="mapWrap">
          <DynamicMap
            visibleLayers={renderedLayers}
            target={searchTarget}
            date={selectedDisplayDate || earliestAvailableDate}
            preloadMaxDate={rangeEndDate}
            preloadMinDate={rangeStartDate}
            onTileStatus={handleTileStatus}
          />
          <div className="dayTimeline">
            <div className="dayTimelineHeader">
              <span>{rangeStartDate}</span>
              <strong>{selectedDate ? timelineDisplayDate : "Loading latest date"}</strong>
              <span>{rangeEndDate}</span>
            </div>
            <input
              type="range"
              min={0}
              max={timelineDayCount}
              step={1}
              value={timelineDisplayDateIndex}
              disabled={!hasLatestAvailableDate || !selectedDate}
              aria-label="Daily Dynamic World timeline"
              onChange={(event) =>
                previewTimelineDate(addDays(rangeStartDate, Number(event.currentTarget.value)))
              }
              onBlur={(event) =>
                commitTimelineDate(addDays(rangeStartDate, Number(event.currentTarget.value)))
              }
              onKeyUp={(event) =>
                commitTimelineDate(addDays(rangeStartDate, Number(event.currentTarget.value)))
              }
              onPointerUp={(event) =>
                commitTimelineDate(addDays(rangeStartDate, Number(event.currentTarget.value)))
              }
            />
          </div>
        </div>
      </section>
    </main>
  );
}
