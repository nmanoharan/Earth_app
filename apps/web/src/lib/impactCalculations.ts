import { type WorkLocationMarker } from "@/lib/workLocations";

// EPA Greenhouse Gas Equivalencies: about 132.3 lbs CO2 per urban tree per year.
export const EPA_URBAN_TREE_CO2_METRIC_TONS_PER_YEAR = 0.06;
// EPA/i-Tree style annual fallbacks used when the sheet does not list an annual value.
export const EPA_ITREE_AVOIDED_RUNOFF_GALLONS_PER_TREE_YEAR = 9693.12;
export const EPA_ITREE_AIR_POLLUTANTS_GRAMS_PER_TREE_YEAR = 50.604;
// i-Tree national avoided-runoff value and aggregate urban air-pollutant value.
export const ITREE_AVOIDED_RUNOFF_USD_PER_GALLON = 0.008936;
export const MATURE_CANOPY_SQ_FT_PER_TREE = 1500;
export const GRAMS_PER_POUND = 453.59237;
export const POUNDS_PER_METRIC_TON = 2204.62262185;
export const ITREE_URBAN_AIR_POLLUTANT_USD_PER_POUND = 7.0392 / (1000 / GRAMS_PER_POUND);
export const ROAD_PAVEMENT_SHADE_SHARE = 0.2;
export const USFS_PAVEMENT_SHADE_SAVINGS_USD_PER_SQ_FT_30_YEARS = 0.66;
export const ROAD_RESURFACING_COST_USD_PER_CANOPY_SQ_FT_YEAR =
  (USFS_PAVEMENT_SHADE_SAVINGS_USD_PER_SQ_FT_30_YEARS / 30) *
  ROAD_PAVEMENT_SHADE_SHARE;
export const ENERGY_BUILDING_ADJACENCY_SHARE = 0.35;
export const TREE_ENERGY_SAVINGS_USD_PER_TREE_YEAR = 14;

const ITREE_AIR_POLLUTANT_REMOVAL_RATES = [
  {
    color: "#7c2d12",
    description: "Ozone",
    label: "O3",
    removalRateGm2Year: 5.49
  },
  {
    color: "#b45309",
    description: "Particulate matter 2.5-10 microns",
    label: "PM10*",
    removalRateGm2Year: 1.839
  },
  {
    color: "#ca8a04",
    description: "Nitrogen dioxide",
    label: "NO2",
    removalRateGm2Year: 0.551
  },
  {
    color: "#4d7c0f",
    description: "Sulfur dioxide",
    label: "SO2",
    removalRateGm2Year: 0.347
  },
  {
    color: "#0f766e",
    description: "Particulate matter under 2.5 microns",
    label: "PM2.5",
    removalRateGm2Year: 0.267
  },
  {
    color: "#2563eb",
    description: "Carbon monoxide",
    label: "CO",
    removalRateGm2Year: 0.101
  }
];
const TOTAL_ITREE_AIR_POLLUTANT_REMOVAL_RATE = ITREE_AIR_POLLUTANT_REMOVAL_RATES.reduce(
  (total, pollutant) => total + pollutant.removalRateGm2Year,
  0
);

export const ITREE_AIR_POLLUTANT_BREAKDOWN = ITREE_AIR_POLLUTANT_REMOVAL_RATES.map(
  (pollutant) => ({
    ...pollutant,
    share: pollutant.removalRateGm2Year / TOTAL_ITREE_AIR_POLLUTANT_REMOVAL_RATE
  })
);

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const AVERAGE_DAYS_PER_MONTH = 365.2425 / 12;

export type WorkImpactSummary = {
  airPollutantValueAvoided: number;
  airPollutants: number;
  canopy: number;
  co2Saved: number;
  energyCostSaved: number;
  expense: number;
  locations: number;
  plantings: number;
  rainRunoff: number;
  roadResurfacingCostAvoided: number;
  stormwaterCostAvoided: number;
  volunteerHours: number;
};

export const EMPTY_WORK_IMPACT_SUMMARY: WorkImpactSummary = {
  airPollutantValueAvoided: 0,
  airPollutants: 0,
  canopy: 0,
  co2Saved: 0,
  energyCostSaved: 0,
  expense: 0,
  locations: 0,
  plantings: 0,
  rainRunoff: 0,
  roadResurfacingCostAvoided: 0,
  stormwaterCostAvoided: 0,
  volunteerHours: 0
};

export function isDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function formatDateValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function formatDateValueForTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function parseIsoDate(value: string | null | undefined) {
  if (!value || !isDateValue(value)) {
    return null;
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function getPeriodMonths(
  marker: WorkLocationMarker,
  periodStartDate: string,
  periodEndDate: string
) {
  const plantingDate = parseIsoDate(marker.plantingDate);
  const periodStart = parseIsoDate(periodStartDate);
  const periodEnd = parseIsoDate(periodEndDate);

  if (!plantingDate || !periodStart || !periodEnd || periodEnd <= periodStart) {
    return 0;
  }

  const effectiveStart = plantingDate > periodStart ? formatDateValue(plantingDate) : periodStartDate;

  return monthsBetween(effectiveStart, periodEndDate);
}

function isActiveByDate(marker: WorkLocationMarker, endDate: string) {
  const plantingDate = parseIsoDate(marker.plantingDate);
  const periodEnd = parseIsoDate(endDate);

  return Boolean(plantingDate && periodEnd && plantingDate < periodEnd);
}

export function monthsBetween(startDate: string | null | undefined, endDate: string) {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);

  if (!start || !end || end <= start) {
    return 0;
  }

  return (end.getTime() - start.getTime()) / MS_PER_DAY / AVERAGE_DAYS_PER_MONTH;
}

export function getPlantingEquivalentCount(marker: WorkLocationMarker) {
  if (marker.plantings && marker.plantings > 0) {
    return marker.plantings;
  }

  if (marker.treeCanopy && marker.treeCanopy > 0) {
    return marker.treeCanopy / MATURE_CANOPY_SQ_FT_PER_TREE;
  }

  return null;
}

function getCanopyEquivalentSqFt(
  marker: WorkLocationMarker,
  plantingEquivalents: number | null
) {
  if (marker.treeCanopy && marker.treeCanopy > 0) {
    return marker.treeCanopy;
  }

  return plantingEquivalents ? plantingEquivalents * MATURE_CANOPY_SQ_FT_PER_TREE : null;
}

function getAnnualImpactValue(
  sheetValue: number | null,
  plantingEquivalents: number | null,
  fallbackPerTree: number
) {
  if (sheetValue && sheetValue > 0) {
    return sheetValue;
  }

  return plantingEquivalents ? plantingEquivalents * fallbackPerTree : null;
}

function prorateAnnualImpact(annualValue: number | null, ageMonths: number) {
  if (!annualValue || ageMonths <= 0) {
    return null;
  }

  return annualValue * (ageMonths / 12);
}

function estimateWorkImpactForMonths(marker: WorkLocationMarker, impactMonths: number) {
  const plantingEquivalents = getPlantingEquivalentCount(marker);
  if (impactMonths <= 0) {
    return {
      airPollutants: null,
      airPollutantValueAvoided: null,
      co2Saved: null,
      energyCostSaved: null,
      impactAgeMonths: impactMonths,
      rainRunoff: null,
      roadResurfacingCostAvoided: null,
      stormwaterCostAvoided: null
    };
  }

  const canopyEquivalentSqFt = getCanopyEquivalentSqFt(marker, plantingEquivalents);
  const co2Saved = plantingEquivalents
    ? plantingEquivalents *
      EPA_URBAN_TREE_CO2_METRIC_TONS_PER_YEAR *
      (impactMonths / 12)
    : null;
  const annualRainRunoff = getAnnualImpactValue(
    marker.rainRunoff,
    plantingEquivalents,
    EPA_ITREE_AVOIDED_RUNOFF_GALLONS_PER_TREE_YEAR
  );
  const annualAirPollutants = getAnnualImpactValue(
    marker.airPollutants,
    plantingEquivalents,
    EPA_ITREE_AIR_POLLUTANTS_GRAMS_PER_TREE_YEAR
  );
  const annualRoadResurfacingCostAvoided = canopyEquivalentSqFt
    ? canopyEquivalentSqFt * ROAD_RESURFACING_COST_USD_PER_CANOPY_SQ_FT_YEAR
    : null;
  const annualEnergyCostSaved = plantingEquivalents
    ? plantingEquivalents *
      TREE_ENERGY_SAVINGS_USD_PER_TREE_YEAR *
      ENERGY_BUILDING_ADJACENCY_SHARE
    : null;
  const rainRunoff = prorateAnnualImpact(annualRainRunoff, impactMonths);
  const airPollutants = prorateAnnualImpact(annualAirPollutants, impactMonths);

  return {
    airPollutants,
    airPollutantValueAvoided:
      airPollutants === null
        ? null
        : (gramsToPounds(airPollutants) ?? 0) * ITREE_URBAN_AIR_POLLUTANT_USD_PER_POUND,
    co2Saved,
    energyCostSaved: prorateAnnualImpact(annualEnergyCostSaved, impactMonths),
    impactAgeMonths: impactMonths,
    rainRunoff,
    roadResurfacingCostAvoided: prorateAnnualImpact(
      annualRoadResurfacingCostAvoided,
      impactMonths
    ),
    stormwaterCostAvoided:
      rainRunoff === null ? null : rainRunoff * ITREE_AVOIDED_RUNOFF_USD_PER_GALLON
  };
}

export function estimateWorkImpact(marker: WorkLocationMarker, estimateDate: string) {
  if (!isDateValue(estimateDate)) {
    return estimateWorkImpactForMonths(marker, 0);
  }

  return estimateWorkImpactForMonths(
    marker,
    monthsBetween(marker.plantingDate, estimateDate)
  );
}

export function estimateWorkImpactForPeriod(
  marker: WorkLocationMarker,
  periodStartDate: string,
  periodEndDate: string
) {
  if (!isDateValue(periodStartDate) || !isDateValue(periodEndDate)) {
    return estimateWorkImpactForMonths(marker, 0);
  }

  return estimateWorkImpactForMonths(
    marker,
    getPeriodMonths(marker, periodStartDate, periodEndDate)
  );
}

export function withWorkImpact(marker: WorkLocationMarker, estimateDate: string) {
  const {
    airPollutants,
    airPollutantValueAvoided,
    co2Saved,
    energyCostSaved,
    impactAgeMonths,
    rainRunoff,
    roadResurfacingCostAvoided,
    stormwaterCostAvoided
  } = estimateWorkImpact(marker, estimateDate);

  return {
    ...marker,
    airPollutants,
    airPollutantValueAvoided,
    co2AgeMonths: impactAgeMonths,
    co2EstimateDate: estimateDate,
    co2Method: "EPA urban tree estimate: 132.3 lbs CO2 removed per tree per year",
    co2Saved,
    energyCostSaved,
    impactAgeMonths,
    impactEstimateDate: estimateDate,
    impactMethod:
      "EPA/i-Tree monthly estimate plus modeled road resurfacing and energy cost planning estimates",
    rainRunoff,
    roadResurfacingCostAvoided,
    stormwaterCostAvoided
  } satisfies WorkLocationMarker;
}

export function summarizeWorkLocationsForImpactPeriod(
  markers: WorkLocationMarker[],
  periodStartDate: string,
  periodEndDate: string
) {
  return markers
    .filter((marker) => isActiveByDate(marker, periodEndDate))
    .map((marker) => ({
      ...marker,
      ...estimateWorkImpactForPeriod(marker, periodStartDate, periodEndDate)
    }))
    .reduce(
      (summary, marker) => ({
        airPollutantValueAvoided:
          summary.airPollutantValueAvoided + (marker.airPollutantValueAvoided ?? 0),
        airPollutants: summary.airPollutants + (marker.airPollutants ?? 0),
        canopy: summary.canopy + (marker.treeCanopy ?? 0),
        co2Saved: summary.co2Saved + (marker.co2Saved ?? 0),
        energyCostSaved: summary.energyCostSaved + (marker.energyCostSaved ?? 0),
        expense: summary.expense + (marker.expense ?? 0),
        locations: summary.locations + 1,
        plantings: summary.plantings + (marker.plantings ?? 0),
        rainRunoff: summary.rainRunoff + (marker.rainRunoff ?? 0),
        roadResurfacingCostAvoided:
          summary.roadResurfacingCostAvoided + (marker.roadResurfacingCostAvoided ?? 0),
        stormwaterCostAvoided:
          summary.stormwaterCostAvoided + (marker.stormwaterCostAvoided ?? 0),
        volunteerHours: summary.volunteerHours + (marker.volunteerHours ?? 0)
      }),
      EMPTY_WORK_IMPACT_SUMMARY
    );
}

export function summarizeWorkLocations(markers: WorkLocationMarker[]) {
  return markers.reduce(
    (summary, marker) => ({
      airPollutantValueAvoided:
        summary.airPollutantValueAvoided + (marker.airPollutantValueAvoided ?? 0),
      airPollutants: summary.airPollutants + (marker.airPollutants ?? 0),
      canopy: summary.canopy + (marker.treeCanopy ?? 0),
      co2Saved: summary.co2Saved + (marker.co2Saved ?? 0),
      energyCostSaved: summary.energyCostSaved + (marker.energyCostSaved ?? 0),
      expense: summary.expense + (marker.expense ?? 0),
      locations: summary.locations + 1,
      plantings: summary.plantings + (marker.plantings ?? 0),
      rainRunoff: summary.rainRunoff + (marker.rainRunoff ?? 0),
      roadResurfacingCostAvoided:
        summary.roadResurfacingCostAvoided + (marker.roadResurfacingCostAvoided ?? 0),
      stormwaterCostAvoided:
        summary.stormwaterCostAvoided + (marker.stormwaterCostAvoided ?? 0),
      volunteerHours: summary.volunteerHours + (marker.volunteerHours ?? 0)
    }),
    EMPTY_WORK_IMPACT_SUMMARY
  );
}

export function gramsToPounds(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return value / GRAMS_PER_POUND;
}

export function metricTonsToPounds(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return value * POUNDS_PER_METRIC_TON;
}

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 1) {
  if (value === null || value === undefined) {
    return "0";
  }

  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

export function formatCompactNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "0";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: "compact"
  }).format(value);
}

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "$0";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 1,
    notation: "compact",
    style: "currency"
  }).format(value);
}
