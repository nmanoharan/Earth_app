import { NextResponse } from "next/server";
import {
  formatDateValueForTimeZone,
  gramsToPounds,
  isDateValue,
  metricTonsToPounds,
  withWorkImpact
} from "@/lib/impactCalculations";
import { authorizeMobileApiRequest } from "@/lib/mobileApiAuth";
import { getWorkLocationMarkers, type WorkLocationMarker } from "@/lib/workLocations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OEOC_TIME_ZONE = "America/Chicago";
const YEARLY_LOCATION_COLUMNS = [
  "Planting Location",
  "City",
  "Event Count",
  "Events",
  "Planting Dates",
  "Category",
  "Partners",
  "Plantings",
  "Tree Canopy Sq Ft",
  "CO2 Removed Lbs",
  "Runoff Avoided Gallons",
  "Storm Water Management $",
  "Air Pollutants Removed Lbs",
  "Air Pollutant Removal $",
  "Road Resurfacing $",
  "Energy Saving $",
  "Total Cost Savings $",
  "Volunteer Hours",
  "Expense USD",
  "Latitude",
  "Longitude",
  "Approximate Location"
];

type ExcelCell = number | string | boolean | null | undefined;

type NumberAccumulator = {
  hasValue: boolean;
  value: number;
};

type LocationYearGroup = {
  airPollutantValueAvoided: NumberAccumulator;
  airPollutantsLbs: NumberAccumulator;
  categories: Set<string>;
  co2RemovedLbs: NumberAccumulator;
  dates: Set<string>;
  energySaving: NumberAccumulator;
  events: Set<string>;
  expense: NumberAccumulator;
  firstMarker: WorkLocationMarker;
  city: string;
  partners: Set<string>;
  plantings: NumberAccumulator;
  rainRunoff: NumberAccumulator;
  roadResurfacing: NumberAccumulator;
  stormwaterManagement: NumberAccumulator;
  totalCostSavings: NumberAccumulator;
  treeCanopy: NumberAccumulator;
  volunteerHours: NumberAccumulator;
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function addXmlAttribute(name: string, value: string | number | undefined) {
  return value === undefined ? "" : ` ${name}="${escapeXml(String(value))}"`;
}

function cell(
  value: ExcelCell,
  options: { mergeAcross?: number; styleId?: string } = {}
) {
  const attributes = `${addXmlAttribute("ss:StyleID", options.styleId)}${addXmlAttribute(
    "ss:MergeAcross",
    options.mergeAcross
  )}`;

  if (value === null || value === undefined || value === "") {
    return `<Cell${attributes}><Data ss:Type="String"></Data></Cell>`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return `<Cell${attributes}><Data ss:Type="Number">${value}</Data></Cell>`;
  }

  if (typeof value === "boolean") {
    return `<Cell${attributes}><Data ss:Type="String">${value ? "Yes" : "No"}</Data></Cell>`;
  }

  return `<Cell${attributes}><Data ss:Type="String">${escapeXml(String(value))}</Data></Cell>`;
}

function row(cells: ExcelCell[], styleId?: string) {
  return `<Row>${cells.map((value) => cell(value, { styleId })).join("")}</Row>`;
}

function mergedRow(value: string, styleId: string) {
  return `<Row>${cell(value, {
    mergeAcross: YEARLY_LOCATION_COLUMNS.length - 1,
    styleId
  })}</Row>`;
}

function workbook(rows: string[]) {
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Title">
   <Font ss:Bold="1" ss:Size="14" ss:Color="#1B2F28"/>
   <Interior ss:Color="#D8E8DC" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="Meta">
   <Font ss:Color="#4F675C"/>
  </Style>
  <Style ss:ID="Section">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#1F7A4A" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#E2EEE5" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="Total">
   <Font ss:Bold="1"/>
   <Interior ss:Color="#FFF4DC" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="By Planting Location">
  <Table>
   <Column ss:Width="180"/>
   <Column ss:Width="110"/>
   <Column ss:Width="72"/>
   <Column ss:Width="240"/>
   <Column ss:Width="150"/>
   <Column ss:Width="130"/>
   <Column ss:Width="240"/>
   ${Array.from({ length: YEARLY_LOCATION_COLUMNS.length - 7 })
     .map(() => '<Column ss:Width="110"/>')
     .join("\n   ")}
   ${rows.join("\n   ")}
  </Table>
 </Worksheet>
</Workbook>`;
}

function dateFromRequest(value: string | null) {
  return value && isDateValue(value)
    ? value
    : formatDateValueForTimeZone(new Date(), OEOC_TIME_ZONE);
}

function numericValue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function emptyNumberAccumulator(): NumberAccumulator {
  return {
    hasValue: false,
    value: 0
  };
}

function addNumber(accumulator: NumberAccumulator, value: number | null | undefined) {
  const normalizedValue = numericValue(value);
  if (normalizedValue === null) {
    return;
  }

  accumulator.hasValue = true;
  accumulator.value += normalizedValue;
}

function accumulatorValue(accumulator: NumberAccumulator) {
  return accumulator.hasValue ? accumulator.value : null;
}

function uniqueValues(values: Set<string>) {
  return Array.from(values)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((firstValue, secondValue) => firstValue.localeCompare(secondValue))
    .join("; ");
}

const KNOWN_CITY_NAMES = [
  "Arlington",
  "Coppell",
  "Dallas",
  "Euless",
  "Frisco",
  "Irving",
  "Las Colinas",
  "McKinney",
  "Plano",
  "Richardson",
  "Wylie"
];

function cityFromText(value: string) {
  const normalizedValue = value.toLowerCase();

  const matchedCities = KNOWN_CITY_NAMES.map((city) => ({
    city,
    index: normalizedValue.indexOf(city.toLowerCase())
  }))
    .filter((match) => match.index >= 0)
    .sort((firstMatch, secondMatch) => firstMatch.index - secondMatch.index);

  return matchedCities[0]?.city ?? null;
}

function cityFromPlantingLocation(marker: WorkLocationMarker) {
  const locationParts = marker.location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const lastLocationPart = locationParts[locationParts.length - 1];
  const cityFromLocationSuffix = lastLocationPart
    ? KNOWN_CITY_NAMES.find((city) => city.toLowerCase() === lastLocationPart.toLowerCase())
    : null;

  return (
    cityFromLocationSuffix ??
    cityFromText(`${marker.location} ${marker.sourceLocation} ${marker.eventName}`) ??
    cityFromText(marker.partners) ??
    "Unlisted City"
  );
}

function plantingYear(marker: WorkLocationMarker) {
  if (marker.plantingDate) {
    const parsedDate = new Date(`${marker.plantingDate}T00:00:00Z`);
    const parsedYear = parsedDate.getUTCFullYear();

    if (Number.isFinite(parsedYear)) {
      return String(parsedYear);
    }
  }

  return marker.year ? String(marker.year) : "Unlisted Year";
}

function newLocationYearGroup(marker: WorkLocationMarker): LocationYearGroup {
  return {
    airPollutantValueAvoided: emptyNumberAccumulator(),
    airPollutantsLbs: emptyNumberAccumulator(),
    categories: new Set(),
    co2RemovedLbs: emptyNumberAccumulator(),
    dates: new Set(),
    energySaving: emptyNumberAccumulator(),
    events: new Set(),
    expense: emptyNumberAccumulator(),
    firstMarker: marker,
    city: cityFromPlantingLocation(marker),
    partners: new Set(),
    plantings: emptyNumberAccumulator(),
    rainRunoff: emptyNumberAccumulator(),
    roadResurfacing: emptyNumberAccumulator(),
    stormwaterManagement: emptyNumberAccumulator(),
    totalCostSavings: emptyNumberAccumulator(),
    treeCanopy: emptyNumberAccumulator(),
    volunteerHours: emptyNumberAccumulator()
  };
}

function addMarkerToGroup(group: LocationYearGroup, marker: WorkLocationMarker) {
  const co2RemovedLbs = metricTonsToPounds(marker.co2Saved);
  const airPollutantsLbs = gramsToPounds(marker.airPollutants);
  const totalCostSavings =
    (marker.stormwaterCostAvoided ?? 0) +
    (marker.airPollutantValueAvoided ?? 0) +
    (marker.roadResurfacingCostAvoided ?? 0) +
    (marker.energyCostSaved ?? 0);

  group.categories.add(marker.category);
  group.dates.add(marker.plantingDate ?? marker.date);
  group.events.add(marker.eventName || marker.location);
  group.partners.add(marker.partners);

  addNumber(group.airPollutantValueAvoided, marker.airPollutantValueAvoided);
  addNumber(group.airPollutantsLbs, airPollutantsLbs);
  addNumber(group.co2RemovedLbs, co2RemovedLbs);
  addNumber(group.energySaving, marker.energyCostSaved);
  addNumber(group.expense, marker.expense);
  addNumber(group.plantings, marker.plantings);
  addNumber(group.rainRunoff, marker.rainRunoff);
  addNumber(group.roadResurfacing, marker.roadResurfacingCostAvoided);
  addNumber(group.stormwaterManagement, marker.stormwaterCostAvoided);
  addNumber(group.treeCanopy, marker.treeCanopy);
  addNumber(group.volunteerHours, marker.volunteerHours);

  if (
    [
      marker.stormwaterCostAvoided,
      marker.airPollutantValueAvoided,
      marker.roadResurfacingCostAvoided,
      marker.energyCostSaved
    ].some((costValue) => numericValue(costValue) !== null)
  ) {
    addNumber(group.totalCostSavings, totalCostSavings);
  }
}

function groupMarkersByYearAndLocation(markers: WorkLocationMarker[], estimateDate: string) {
  const groupsByYear = new Map<string, Map<string, LocationYearGroup>>();

  markers.forEach((marker) => {
    const impactedMarker = withWorkImpact(marker, estimateDate);
    const year = plantingYear(impactedMarker);
    const city = cityFromPlantingLocation(impactedMarker);
    const locationKey = `${city.toLowerCase()}::${impactedMarker.location.trim().toLowerCase()}`;
    const yearGroups = groupsByYear.get(year) ?? new Map<string, LocationYearGroup>();
    let group = yearGroups.get(locationKey);

    if (!group) {
      group = newLocationYearGroup(impactedMarker);
      yearGroups.set(locationKey, group);
      groupsByYear.set(year, yearGroups);
    }

    addMarkerToGroup(group, impactedMarker);
  });

  return groupsByYear;
}

function isYearLabel(value: string) {
  return /^\d{4}$/.test(value);
}

function sortYearLabels(firstYear: string, secondYear: string) {
  if (isYearLabel(firstYear) && isYearLabel(secondYear)) {
    return Number(secondYear) - Number(firstYear);
  }

  if (isYearLabel(firstYear)) {
    return -1;
  }

  if (isYearLabel(secondYear)) {
    return 1;
  }

  return firstYear.localeCompare(secondYear);
}

function locationGroupToRow(group: LocationYearGroup): ExcelCell[] {
  const marker = group.firstMarker;

  return [
    marker.location,
    group.city,
    group.events.size,
    uniqueValues(group.events),
    uniqueValues(group.dates),
    uniqueValues(group.categories),
    uniqueValues(group.partners),
    accumulatorValue(group.plantings),
    accumulatorValue(group.treeCanopy),
    accumulatorValue(group.co2RemovedLbs),
    accumulatorValue(group.rainRunoff),
    accumulatorValue(group.stormwaterManagement),
    accumulatorValue(group.airPollutantsLbs),
    accumulatorValue(group.airPollutantValueAvoided),
    accumulatorValue(group.roadResurfacing),
    accumulatorValue(group.energySaving),
    accumulatorValue(group.totalCostSavings),
    accumulatorValue(group.volunteerHours),
    accumulatorValue(group.expense),
    marker.lat,
    marker.lng,
    marker.estimated
  ];
}

function addGroupToTotal(total: LocationYearGroup, group: LocationYearGroup) {
  addNumber(total.airPollutantValueAvoided, accumulatorValue(group.airPollutantValueAvoided));
  addNumber(total.airPollutantsLbs, accumulatorValue(group.airPollutantsLbs));
  addNumber(total.co2RemovedLbs, accumulatorValue(group.co2RemovedLbs));
  addNumber(total.energySaving, accumulatorValue(group.energySaving));
  addNumber(total.expense, accumulatorValue(group.expense));
  addNumber(total.plantings, accumulatorValue(group.plantings));
  addNumber(total.rainRunoff, accumulatorValue(group.rainRunoff));
  addNumber(total.roadResurfacing, accumulatorValue(group.roadResurfacing));
  addNumber(total.stormwaterManagement, accumulatorValue(group.stormwaterManagement));
  addNumber(total.totalCostSavings, accumulatorValue(group.totalCostSavings));
  addNumber(total.treeCanopy, accumulatorValue(group.treeCanopy));
  addNumber(total.volunteerHours, accumulatorValue(group.volunteerHours));
  group.categories.forEach((category) => total.categories.add(category));
  group.dates.forEach((date) => total.dates.add(date));
  group.events.forEach((event) => total.events.add(event));
  group.partners.forEach((partner) => total.partners.add(partner));
}

function totalGroupToRow(total: LocationYearGroup): ExcelCell[] {
  return [
    "Year Total",
    "",
    total.events.size,
    "",
    "",
    uniqueValues(total.categories),
    "",
    accumulatorValue(total.plantings),
    accumulatorValue(total.treeCanopy),
    accumulatorValue(total.co2RemovedLbs),
    accumulatorValue(total.rainRunoff),
    accumulatorValue(total.stormwaterManagement),
    accumulatorValue(total.airPollutantsLbs),
    accumulatorValue(total.airPollutantValueAvoided),
    accumulatorValue(total.roadResurfacing),
    accumulatorValue(total.energySaving),
    accumulatorValue(total.totalCostSavings),
    accumulatorValue(total.volunteerHours),
    accumulatorValue(total.expense),
    "",
    "",
    ""
  ];
}

function yearlyLocationRows(markers: WorkLocationMarker[], estimateDate: string, warning?: string) {
  const groupsByYear = groupMarkersByYearAndLocation(markers, estimateDate);
  const rows = [
    mergedRow("OEOC Impact by Planting Location and Year", "Title"),
    row(["Impact Estimate Date", estimateDate], "Meta"),
    row(["Export Layout", "Year sections with one aggregated row per city planting location"], "Meta"),
    row(["Source", warning ? `Cached Tree Map snapshot; ${warning}` : "Live Tree Map sheet"], "Meta"),
    "<Row />"
  ];

  Array.from(groupsByYear.keys())
    .sort(sortYearLabels)
    .forEach((year) => {
      const groups = Array.from(groupsByYear.get(year)?.values() ?? []).sort((firstGroup, secondGroup) =>
        firstGroup.city.localeCompare(secondGroup.city) ||
        firstGroup.firstMarker.location.localeCompare(secondGroup.firstMarker.location)
      );
      const firstGroup = groups[0];

      if (!firstGroup) {
        return;
      }

      const total = newLocationYearGroup(firstGroup.firstMarker);

      rows.push(mergedRow(`${year} Planting Locations`, "Section"));
      rows.push(row(YEARLY_LOCATION_COLUMNS, "Header"));

      groups.forEach((group) => {
        rows.push(row(locationGroupToRow(group)));
        addGroupToTotal(total, group);
      });

      rows.push(row(totalGroupToRow(total), "Total"));
      rows.push("<Row />");
    });

  return rows;
}

export async function GET(request: Request) {
  const unauthorizedResponse = authorizeMobileApiRequest(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const url = new URL(request.url);
  const estimateDate = dateFromRequest(url.searchParams.get("estimateDate"));
  const payload = await getWorkLocationMarkers();
  const body = workbook(yearlyLocationRows(payload.markers, estimateDate, payload.warning));

  return new NextResponse(body, {
    headers: {
      "Content-Disposition": `attachment; filename="oeoc-impact-by-planting-location-${estimateDate}.xls"`,
      "Content-Type": "application/vnd.ms-excel; charset=utf-8"
    }
  });
}
