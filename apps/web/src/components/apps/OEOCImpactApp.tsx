"use client";

import dynamic from "next/dynamic";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { type ForestLayerId } from "@forest/shared";
import { type MapTarget } from "@/components/map/MapView";
import {
  EPA_ITREE_AIR_POLLUTANTS_GRAMS_PER_TREE_YEAR,
  EPA_ITREE_AVOIDED_RUNOFF_GALLONS_PER_TREE_YEAR,
  EPA_URBAN_TREE_CO2_METRIC_TONS_PER_YEAR,
  ENERGY_BUILDING_ADJACENCY_SHARE,
  formatCompactNumber,
  formatCurrency,
  formatDateValueForTimeZone,
  formatNumber,
  gramsToPounds,
  ITREE_AVOIDED_RUNOFF_USD_PER_GALLON,
  ITREE_AIR_POLLUTANT_BREAKDOWN,
  ITREE_URBAN_AIR_POLLUTANT_USD_PER_POUND,
  MATURE_CANOPY_SQ_FT_PER_TREE,
  metricTonsToPounds,
  ROAD_PAVEMENT_SHADE_SHARE,
  ROAD_RESURFACING_COST_USD_PER_CANOPY_SQ_FT_YEAR,
  summarizeWorkLocations,
  summarizeWorkLocationsForImpactPeriod,
  TREE_ENERGY_SAVINGS_USD_PER_TREE_YEAR,
  USFS_PAVEMENT_SHADE_SAVINGS_USD_PER_SQ_FT_30_YEARS,
  type WorkImpactSummary,
  withWorkImpact
} from "@/lib/impactCalculations";
import { type WorkLocationMarker } from "@/lib/workLocations";

type OEOCImpactAppProps = {
  initialDataSource?: "live" | "snapshot";
  initialDataWarning?: string;
  initialLoadError?: boolean;
  initialMarkers: WorkLocationMarker[];
  initialSkippedRows: number;
  initialUpdatedAt?: string;
};

type YearlyImpactRow = {
  summary: WorkImpactSummary;
  year: string;
};

type ImpactMetricId = "airPollutants" | "co2Saved" | "costSavings" | "rainRunoff";

type ImpactBreakdownDefinition = {
  color: string;
  getValue: (summary: WorkImpactSummary) => number;
  label: string;
};

type EstimateSourceLink = {
  href: string;
  label: string;
};

type ImpactMetricEstimateDefinition = {
  notes: string[];
  sources: EstimateSourceLink[];
  title: string;
};

type ImpactMetricDefinition = {
  accent: string;
  breakdown?: ImpactBreakdownDefinition[];
  description: string;
  estimate: ImpactMetricEstimateDefinition;
  format: (value: number) => string;
  getValue: (summary: WorkImpactSummary) => number;
  id: ImpactMetricId;
  label: string;
  unit: string;
};

const DynamicMap = dynamic(() => import("@/components/map/MapView").then((m) => m.MapView), {
  ssr: false
});

const WORK_CATEGORY_COLORS: Record<string, string> = {
  "native plants": "#7c3aed",
  trees: "#1f7a4a",
  "tree giveaway": "#d97706"
};

const NO_FOREST_LAYERS: Record<ForestLayerId, boolean> = {
  forestLoss: false,
  landCover: false,
  treeCover: false
};
const DFW_MAP_CENTER: [number, number] = [32.92, -96.82];
const DFW_MAP_ZOOM = 10;
const MAP_HEIGHT_MAX = 900;
const MAP_HEIGHT_MIN = 360;
const OEOC_TIME_ZONE = "America/Chicago";
const CO2_REMOVED_LBS_PER_TREE_YEAR =
  metricTonsToPounds(EPA_URBAN_TREE_CO2_METRIC_TONS_PER_YEAR) ?? 0;
const AIR_POLLUTANTS_LBS_PER_TREE_YEAR =
  gramsToPounds(EPA_ITREE_AIR_POLLUTANTS_GRAMS_PER_TREE_YEAR) ?? 0;
const STORMWATER_COST_RATE_LABEL = `$${ITREE_AVOIDED_RUNOFF_USD_PER_GALLON.toFixed(4)}`;
const AIR_POLLUTANT_COST_RATE_LABEL = `$${ITREE_URBAN_AIR_POLLUTANT_USD_PER_POUND.toFixed(2)}`;
const ROAD_RESURFACING_COST_RATE_LABEL = `$${ROAD_RESURFACING_COST_USD_PER_CANOPY_SQ_FT_YEAR.toFixed(4)}`;
const PAVEMENT_SHADE_SAVINGS_30_YEAR_LABEL = `$${USFS_PAVEMENT_SHADE_SAVINGS_USD_PER_SQ_FT_30_YEARS.toFixed(2)}`;
const TREE_ENERGY_SAVINGS_RATE_LABEL = `$${TREE_ENERGY_SAVINGS_USD_PER_TREE_YEAR.toFixed(2)}`;
const CUMULATIVE_YEAR_NOTE =
  "Yearly bars use calendar-year impact: plantings and canopy from prior years continue contributing in later years, and the current year is prorated through the estimate date.";
const EPA_GREENHOUSE_GAS_SOURCE = {
  href: "https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator-calculations-and-references",
  label: "EPA greenhouse gas equivalencies"
};
const EPA_HEAT_ISLAND_SOURCE = {
  href: "https://www.epa.gov/heatislands/benefits-trees-and-vegetation",
  label: "EPA tree cooling benefits"
};
const ITREE_CANOPY_SOURCE = {
  href: "https://canopy.itreetools.org/benefits",
  label: "i-Tree Canopy benefits"
};
const ITREE_AIR_POLLUTION_SOURCE = {
  href: "https://landscape.itreetools.org/references/data/",
  label: "i-Tree air pollution data"
};
const ITREE_METHODS_SOURCE = {
  href: "https://dev.itreetools.org/support/resources-overview/i-tree-methods-and-files",
  label: "i-Tree methods"
};
const USFS_PAVEMENT_SHADE_SOURCE = {
  href: "https://research.fs.usda.gov/treesearch/46009",
  label: "USFS pavement shade study"
};
const USFS_TREE_ENERGY_SOURCE = {
  href: "https://research.fs.usda.gov/treesearch/60565",
  label: "USFS tree shade energy study"
};
const IMPACT_METRICS: ImpactMetricDefinition[] = [
  {
    accent: "#0f766e",
    description: "Monthly EPA urban-tree carbon estimate through today.",
    estimate: {
      notes: [
        `Planting equivalent = planted trees when listed, otherwise tree canopy / ${formatNumber(
          MATURE_CANOPY_SQ_FT_PER_TREE,
          0
        )} sq ft.`,
        `CO2 removed = planting equivalent x ${formatNumber(
          CO2_REMOVED_LBS_PER_TREE_YEAR,
          1
        )} lbs per tree per year x months since planting / 12.`,
        CUMULATIVE_YEAR_NOTE
      ],
      sources: [EPA_GREENHOUSE_GAS_SOURCE],
      title: "EPA carbon removal estimate"
    },
    format: formatCompactNumber,
    getValue: (summary) => metricTonsToPounds(summary.co2Saved) ?? 0,
    id: "co2Saved",
    label: "CO2 Removed",
    unit: "lbs"
  },
  {
    accent: "#d97706",
    breakdown: ITREE_AIR_POLLUTANT_BREAKDOWN.map((pollutant) => ({
      color: pollutant.color,
      getValue: (summary) => (gramsToPounds(summary.airPollutants) ?? 0) * pollutant.share,
      label: `${pollutant.label} ${formatPercentShare(pollutant.share)}`
    })),
    description: "Estimated criteria pollutants removed over time; CO2 is excluded.",
    estimate: {
      notes: [
        `Air pollutants removed = sheet annual pollutant value when listed, otherwise planting equivalent x ${formatNumber(
          AIR_POLLUTANTS_LBS_PER_TREE_YEAR,
          3
        )} lbs per year, prorated monthly.`,
        "This total includes criteria air pollutants only. CO2 is excluded here to avoid double counting the separate CO2 Removed graph.",
        CUMULATIVE_YEAR_NOTE
      ],
      sources: [ITREE_AIR_POLLUTION_SOURCE, ITREE_CANOPY_SOURCE, ITREE_METHODS_SOURCE],
      title: "i-Tree air pollutant estimate"
    },
    format: (value) => formatNumber(value, 1),
    getValue: (summary) => gramsToPounds(summary.airPollutants) ?? 0,
    id: "airPollutants",
    label: "Air Pollutants Removed",
    unit: "lbs"
  },
  {
    accent: "#2563eb",
    description: "Estimated stormwater runoff avoided by tree canopy.",
    estimate: {
      notes: [
        `Runoff avoided = sheet annual runoff when listed, otherwise planting equivalent x ${formatNumber(
          EPA_ITREE_AVOIDED_RUNOFF_GALLONS_PER_TREE_YEAR,
          0
        )} gallons per year.`,
        "Annual runoff benefit is prorated monthly from planting date through the estimate date.",
        CUMULATIVE_YEAR_NOTE
      ],
      sources: [ITREE_CANOPY_SOURCE, ITREE_METHODS_SOURCE],
      title: "i-Tree runoff estimate"
    },
    format: formatCompactNumber,
    getValue: (summary) => summary.rainRunoff,
    id: "rainRunoff",
    label: "Runoff Avoided",
    unit: "gallons"
  },
  {
    accent: "#0ea5e9",
    breakdown: [
      {
        color: "#0ea5e9",
        getValue: (summary) => summary.stormwaterCostAvoided,
        label: "Storm Water Management $"
      },
      {
        color: "#b45309",
        getValue: (summary) => summary.airPollutantValueAvoided,
        label: "Air Pollutant Removal $"
      },
      {
        color: "#64748b",
        getValue: (summary) => summary.roadResurfacingCostAvoided,
        label: "Road Resurfacing $"
      },
      {
        color: "#7c3aed",
        getValue: (summary) => summary.energyCostSaved,
        label: "Energy Saving $"
      }
    ],
    description:
      "Combined avoided cost from storm water, air pollutant removal, road resurfacing, and energy estimates.",
    estimate: {
      notes: [
        `Storm Water Management $ = runoff gallons x ${STORMWATER_COST_RATE_LABEL} per gallon.`,
        `Air Pollutant Removal $ = air pollutant lbs x ${AIR_POLLUTANT_COST_RATE_LABEL} per lb.`,
        `Road Resurfacing $ = canopy sq ft x ${ROAD_RESURFACING_COST_RATE_LABEL} per year, prorated monthly. The rate is modeled from ${PAVEMENT_SHADE_SAVINGS_30_YEAR_LABEL}/sq ft over 30 years and a ${formatPercentShare(
          ROAD_PAVEMENT_SHADE_SHARE
        )} assumed road/pavement shade share.`,
        `Energy Saving $ = planting equivalent x ${TREE_ENERGY_SAVINGS_RATE_LABEL} per tree-year x ${formatPercentShare(
          ENERGY_BUILDING_ADJACENCY_SHARE
        )} assumed building-adjacent share, prorated monthly.`,
        "Road Resurfacing $ and Energy Saving $ are planning estimates because the sheet does not include pavement overlap, building distance, building direction, species, or utility data.",
        "The graph stacks all avoided-cost components and does not add CO2 into the air pollutant value.",
        CUMULATIVE_YEAR_NOTE
      ],
      sources: [
        ITREE_CANOPY_SOURCE,
        ITREE_AIR_POLLUTION_SOURCE,
        ITREE_METHODS_SOURCE,
        EPA_HEAT_ISLAND_SOURCE,
        USFS_PAVEMENT_SHADE_SOURCE,
        USFS_TREE_ENERGY_SOURCE
      ],
      title: "Avoided-cost estimate"
    },
    format: formatCurrency,
    getValue: (summary) =>
      summary.stormwaterCostAvoided +
      summary.airPollutantValueAvoided +
      summary.roadResurfacingCostAvoided +
      summary.energyCostSaved,
    id: "costSavings",
    label: "Cost Savings $",
    unit: "USD"
  }
];

function workCategoryColor(category: string) {
  return WORK_CATEGORY_COLORS[category.toLowerCase()] ?? "#2563eb";
}

function plantingYear(marker: WorkLocationMarker) {
  if (marker.plantingDate) {
    return Number(marker.plantingDate.slice(0, 4));
  }

  return marker.year ?? null;
}

function workLocationEventTimestamp(marker: WorkLocationMarker) {
  const dateValue = marker.plantingDate ?? marker.date;

  if (!dateValue || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return 0;
  }

  const timestamp = new Date(`${dateValue}T00:00:00.000Z`).getTime();

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function yearStartDate(year: number) {
  return `${year}-01-01`;
}

function nextYearStartDate(year: number) {
  return `${year + 1}-01-01`;
}

function yearlyImpactRows(markers: WorkLocationMarker[], estimateDate: string) {
  const estimateYear = Number(estimateDate.slice(0, 4));
  const markerYears = markers
    .map(plantingYear)
    .filter((year): year is number => year !== null && Number.isFinite(year));
  const startYear = markerYears.length > 0 ? Math.min(...markerYears) : estimateYear;
  const rows: YearlyImpactRow[] = [];

  for (let year = startYear; year <= estimateYear; year += 1) {
    rows.push({
      summary: summarizeWorkLocationsForImpactPeriod(
        markers,
        yearStartDate(year),
        year === estimateYear ? estimateDate : nextYearStartDate(year)
      ) as WorkImpactSummary,
      year: String(year)
    });
  }

  return rows;
}

function metricMaxValue(metric: ImpactMetricDefinition, rows: YearlyImpactRow[]) {
  return Math.max(1, ...rows.map((row) => metric.getValue(row.summary)));
}

function formatPercentShare(share: number) {
  return `${formatNumber(share * 100, 1)}%`;
}

function formatSnapshotDate(value?: string) {
  if (!value) {
    return "the last successful load";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "the cached snapshot";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: OEOC_TIME_ZONE,
    year: "numeric"
  }).format(date);
}

export function OEOCImpactApp({
  initialDataSource = "live",
  initialDataWarning,
  initialLoadError = false,
  initialMarkers,
  initialUpdatedAt
}: OEOCImpactAppProps) {
  const [workLocations] = useState<WorkLocationMarker[]>(initialMarkers);
  const mapResizeRef = useRef<{ startHeight: number; startY: number } | null>(null);
  const workLocationStatus: "ready" | "snapshot" | "error" = initialLoadError
    ? "error"
    : initialDataSource === "snapshot"
      ? "snapshot"
      : "ready";
  const [estimateDate] = useState(() =>
    formatDateValueForTimeZone(new Date(), OEOC_TIME_ZONE)
  );
  const [mapHeight, setMapHeight] = useState<number>();
  const [openMetricInfo, setOpenMetricInfo] = useState<ImpactMetricId | null>(null);
  const [mapTarget, setMapTarget] = useState<MapTarget>();
  const [selectedEventName, setSelectedEventName] = useState("");

  const workLocationsWithImpact = useMemo(
    () => workLocations.map((marker) => withWorkImpact(marker, estimateDate)),
    [estimateDate, workLocations]
  );
  const categories = useMemo(
    () =>
      Array.from(new Set(workLocationsWithImpact.map((marker) => marker.category).filter(Boolean)))
        .sort((firstCategory, secondCategory) => firstCategory.localeCompare(secondCategory)),
    [workLocationsWithImpact]
  );
  const summary = useMemo(
    () => summarizeWorkLocations(workLocationsWithImpact),
    [workLocationsWithImpact]
  );
  const yearlyImpact = useMemo(
    () => yearlyImpactRows(workLocations, estimateDate),
    [estimateDate, workLocations]
  );
  const metricMaxValues = useMemo(
    () =>
      IMPACT_METRICS.reduce(
        (maxValues, metric) => ({
          ...maxValues,
          [metric.id]: metricMaxValue(metric, yearlyImpact)
        }),
        {} as Record<ImpactMetricId, number>
      ),
    [yearlyImpact]
  );
  const eventOptions = useMemo(() => {
    const eventDateByName = new Map<string, number>();

    workLocations.forEach((marker) => {
      const eventName = marker.eventName.trim();

      if (!eventName) {
        return;
      }

      eventDateByName.set(
        eventName,
        Math.max(eventDateByName.get(eventName) ?? 0, workLocationEventTimestamp(marker))
      );
    });

    return Array.from(eventDateByName.entries())
      .sort((firstEvent, secondEvent) => {
        const dateDifference = secondEvent[1] - firstEvent[1];

        return dateDifference === 0 ? firstEvent[0].localeCompare(secondEvent[0]) : dateDifference;
      })
      .map(([eventName]) => eventName);
  }, [workLocations]);
  const activeEventName = selectedEventName || eventOptions[0] || "";
  const locationExportHref = `/api/work-locations/export-by-location?estimateDate=${encodeURIComponent(
    estimateDate
  )}`;
  const eventExportHref = activeEventName
    ? `/api/work-locations/export-event?estimateDate=${encodeURIComponent(
        estimateDate
      )}&eventName=${encodeURIComponent(activeEventName)}`
    : undefined;
  const workLocationStatusText =
    workLocationStatus === "error"
      ? "Unable to load the Tree Map sheet."
      : workLocationStatus === "snapshot"
        ? `Live Google CSV is unavailable. Showing cached Tree Map snapshot from ${formatSnapshotDate(
            initialUpdatedAt
          )}.`
        : "Markers use the same colors as the yearly bars.";
  const updateMapHeight = useCallback((clientY: number) => {
    const resizeStart = mapResizeRef.current;

    if (!resizeStart) {
      return;
    }

    const viewportMax =
      typeof window === "undefined"
        ? MAP_HEIGHT_MAX
        : Math.max(MAP_HEIGHT_MIN, Math.min(MAP_HEIGHT_MAX, window.innerHeight - 96));
    const nextHeight = Math.round(
      Math.min(
        viewportMax,
        Math.max(MAP_HEIGHT_MIN, resizeStart.startHeight + clientY - resizeStart.startY)
      )
    );

    setMapHeight(nextHeight);
  }, []);
  const beginMapResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const mapWrap = event.currentTarget.closest(".impactMapWrap");
    const startHeight = mapWrap?.getBoundingClientRect().height ?? mapHeight ?? 520;

    event.preventDefault();
    mapResizeRef.current = {
      startHeight,
      startY: event.clientY
    };
  }, [mapHeight]);
  const beginMapMouseResize = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || mapResizeRef.current) {
      return;
    }

    const mapWrap = event.currentTarget.closest(".impactMapWrap");
    const startHeight = mapWrap?.getBoundingClientRect().height ?? mapHeight ?? 520;

    event.preventDefault();
    mapResizeRef.current = {
      startHeight,
      startY: event.clientY
    };
  }, [mapHeight]);
  const endMapResize = useCallback(() => {
    mapResizeRef.current = null;
  }, []);
  useEffect(() => {
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (!mapResizeRef.current) {
        return;
      }

      event.preventDefault();
      updateMapHeight(event.clientY);
    };
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      if (!mapResizeRef.current) {
        return;
      }

      event.preventDefault();
      updateMapHeight(event.clientY);
    };
    const handleResizeEnd = () => {
      mapResizeRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handleResizeEnd);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleResizeEnd);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handleResizeEnd);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleResizeEnd);
    };
  }, [updateMapHeight]);
  useEffect(() => {
    if (eventOptions.length === 0) {
      if (selectedEventName) {
        setSelectedEventName("");
      }

      return;
    }

    if (!selectedEventName || !eventOptions.includes(selectedEventName)) {
      setSelectedEventName(eventOptions[0]);
    }
  }, [eventOptions, selectedEventName]);
  const selectWorkLocation = useCallback((marker: WorkLocationMarker) => {
    setMapTarget({
      id: `work-${marker.id}`,
      label: marker.location,
      lat: marker.lat,
      lng: marker.lng,
      zoom: marker.estimated ? 12 : 15,
      type: "city"
    });
  }, []);

  return (
    <main className="shell appShell impactShell">
      <header className="topBar appTopBar">
        <div>
          <p className="kicker">One Earth One Chance</p>
          <h1>OEOC Environmental Impact</h1>
        </div>
        <nav className="appNav" aria-label="Dashboard actions">
          <a
            className="exportIconButton"
            href={locationExportHref}
            aria-label="Export OEOC planting impact by city, planting location, and year to Excel"
            title="Export planting by city/year"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11z" />
              <circle cx="12" cy="10" r="2.5" />
              <path d="M4 22h16" />
            </svg>
          </a>
          <a
            className="exportIconButton"
            href="/oeoc-impact/help"
            aria-label="Open OEOC dashboard help documentation"
            title="Help documentation"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.7 9a2.4 2.4 0 0 1 4.55 1.05c0 1.85-2.25 2.05-2.25 3.55" />
              <path d="M12 17h.01" />
            </svg>
          </a>
          <div className="eventPdfExport" aria-label="Event PDF export">
            <label className="eventExportControl">
              <span>PDF Event</span>
              <select
                value={activeEventName}
                onChange={(event) => setSelectedEventName(event.target.value)}
                disabled={eventOptions.length === 0}
              >
                {eventOptions.map((eventName) => (
                  <option key={eventName} value={eventName}>
                    {eventName}
                  </option>
                ))}
              </select>
            </label>
            <a
              className="exportIconButton exportIconButtonPrimary"
              href={eventExportHref}
              aria-disabled={!eventExportHref}
              aria-label="Export selected OEOC event impact PDF"
              title="Export selected event PDF"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M7 2h7l5 5v15H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
                <path d="M14 2v6h5" />
                <path d="M8 13h8" />
                <path d="M8 17h5" />
                <path d="M8 9h2" />
              </svg>
            </a>
          </div>
        </nav>
      </header>

      <section
        className="mapWrap impactMapWrap"
        style={
          {
            "--impact-map-height": mapHeight === undefined ? undefined : `${mapHeight}px`
          } as CSSProperties
        }
      >
        <DynamicMap
          date={estimateDate}
          initialCenter={DFW_MAP_CENTER}
          initialZoom={DFW_MAP_ZOOM}
          target={mapTarget}
          visibleLayers={NO_FOREST_LAYERS}
          workLocations={workLocationsWithImpact}
          onWorkLocationSelect={selectWorkLocation}
        />
        <div className="mapOverlayBadge" aria-live="polite">
          <strong>Work location map</strong>
          <span>
            {formatNumber(summary.locations, 0)} locations ·{" "}
            {formatNumber(summary.plantings, 0)} plantings
          </span>
          <span>{formatCompactNumber(summary.canopy)} canopy sq ft</span>
        </div>
        <aside className="impactMapLegend" aria-label="Work location legend">
          <div className="sectionHeaderInline">
            <h2>Legend</h2>
            <span>{formatNumber(summary.plantings, 0)} plantings</span>
          </div>
          <p
            className={
              workLocationStatus === "error"
                ? "workOverlayStatus error"
                : workLocationStatus === "snapshot"
                  ? "workOverlayStatus snapshot"
                  : "workOverlayStatus"
            }
            title={initialDataWarning}
          >
            {workLocationStatusText}
          </p>
          <div className="workCategoryLegend" aria-label="Work location color legend">
            {categories.map((category) => (
              <span key={category}>
                <span
                  className="workLegendDot"
                  style={{ background: workCategoryColor(category) }}
                />
                {category}
              </span>
            ))}
          </div>
        </aside>
        <button
          className="mapResizeHandle"
          type="button"
          aria-label="Resize map height"
          title="Resize map height"
          onPointerDown={beginMapResize}
          onPointerCancel={endMapResize}
          onMouseDown={beginMapMouseResize}
        >
          <svg aria-hidden="true" viewBox="0 0 32 12">
            <path d="M7 3h18" />
            <path d="M10 6h12" />
            <path d="M13 9h6" />
          </svg>
        </button>
      </section>

      <section className="impactYearSection">
        <div className="impactMetricSections">
          {IMPACT_METRICS.map((metric) => {
            const metricMax = metricMaxValues[metric.id] ?? 1;
            const totalValue = metric.getValue(summary);
            const isMetricInfoOpen = openMetricInfo === metric.id;
            const metricInfoPanelId = `metric-estimate-${metric.id}`;

            return (
              <section
                className="impactMetricSection"
                key={metric.id}
                style={{ "--metric-color": metric.accent } as CSSProperties}
              >
                <header className="metricSectionHeader">
                  <div>
                    <div className="metricTitleRow">
                      <h3>{metric.label}</h3>
                      <button
                        className="metricInfoButton"
                        type="button"
                        aria-controls={metricInfoPanelId}
                        aria-expanded={isMetricInfoOpen}
                        aria-label={`Show ${metric.label} estimate details`}
                        title={`${metric.label} estimate details`}
                        onClick={() =>
                          setOpenMetricInfo((currentMetric) =>
                            currentMetric === metric.id ? null : metric.id
                          )
                        }
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 10v7" />
                          <path d="M12 7h.01" />
                        </svg>
                      </button>
                    </div>
                    <p>{metric.description}</p>
                  </div>
                  <div className="metricTotal">
                    <strong>{metric.format(totalValue)}</strong>
                    <span>{metric.unit}</span>
                  </div>
                </header>
                {metric.breakdown && (
                  <div className="metricBreakdownLegend" aria-label={`${metric.label} breakdown`}>
                    {metric.breakdown.map((item) => (
                      <span key={item.label}>
                        <span style={{ background: item.color }} />
                        {item.label}
                      </span>
                    ))}
                  </div>
                )}
                {isMetricInfoOpen && (
                  <div
                    className="metricEstimatePanel"
                    id={metricInfoPanelId}
                    aria-label={`${metric.label} estimate details`}
                  >
                    <strong>{metric.estimate.title}</strong>
                    <ul>
                      {metric.estimate.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                    {metric.id === "airPollutants" && (
                      <div className="pollutantBreakdownList" aria-label="Air pollutant split">
                        <strong>Approximate pollutant split</strong>
                        {ITREE_AIR_POLLUTANT_BREAKDOWN.map((pollutant) => (
                          <span key={pollutant.label}>
                            <span style={{ background: pollutant.color }} />
                            {pollutant.label}: {pollutant.description} ·{" "}
                            {formatPercentShare(pollutant.share)}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="estimateSourceLinks" aria-label={`${metric.label} sources`}>
                      {metric.estimate.sources.map((link) => (
                        <a href={link.href} key={link.href} target="_blank" rel="noreferrer">
                          {link.label}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div className="metricYearBars" aria-label={`${metric.label} by year`}>
                  {yearlyImpact.map((row) => {
                    const value = metric.getValue(row.summary);
                    const percent = value <= 0 ? 0 : Math.max(2, (value / metricMax) * 100);

                    return (
                      <article className="metricYearBar" key={`${metric.id}-${row.year}`}>
                        <span className="metricYearValue">{metric.format(value)}</span>
                        <div className="metricVerticalTrack" aria-hidden="true">
                          <div className="metricVerticalFill" style={{ height: `${percent}%` }}>
                            {metric.breakdown?.map((item) => {
                              const breakdownValue = item.getValue(row.summary);
                              if (breakdownValue <= 0 || value <= 0) {
                                return null;
                              }

                              return (
                                <span
                                  key={item.label}
                                  style={{
                                    background: item.color,
                                    height: `${(breakdownValue / value) * 100}%`
                                  }}
                                />
                              );
                            })}
                          </div>
                        </div>
                        <strong>{row.year}</strong>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </main>
  );
}
