import cachedWorkLocationSnapshot from "@/data/work-location-markers.snapshot.json";

const WORK_SHEET_ID = "1kSUceIz25w52384bkZ1gV5O_AZOdytE5RMMtNf-jLNI";
const TREE_MAP_GID = "604593198";
const TREE_MAP_CSV_URL = `https://docs.google.com/spreadsheets/d/${WORK_SHEET_ID}/export?format=csv&gid=${TREE_MAP_GID}`;

type CsvRecord = Record<string, string>;

type WorkLocationSource = {
  gid: string;
  name: string;
  spreadsheetId: string;
};

export type WorkLocationMarker = {
  airPollutants: number | null;
  airPollutantValueAvoided?: number | null;
  category: string;
  co2AgeMonths?: number;
  co2EstimateDate?: string;
  co2Method?: string;
  co2Saved: number | null;
  date: string;
  energyCostSaved?: number | null;
  estimated: boolean;
  eventName: string;
  expense: number | null;
  id: string;
  impactAgeMonths?: number;
  impactEstimateDate?: string;
  impactMethod?: string;
  lat: number;
  lng: number;
  location: string;
  paid: string;
  plantingDate: string | null;
  partners: string;
  plantings: number | null;
  plantingLocations: number | null;
  rainRunoff: number | null;
  roadResurfacingCostAvoided?: number | null;
  stormwaterCostAvoided?: number | null;
  sourceLocation: string;
  treeCanopy: number | null;
  volunteerHours: number | null;
  year: number | null;
};

export type WorkLocationPayload = {
  markers: WorkLocationMarker[];
  skippedRows: number;
  snapshot?: boolean;
  source: WorkLocationSource;
  updatedAt: string;
  warning?: string;
};

type Coordinates = {
  lat: number;
  lng: number;
};

type LocationSplit = {
  listedPlantings: number | null;
  location: string;
};

const WORK_LOCATION_SOURCE: WorkLocationSource = {
  gid: TREE_MAP_GID,
  name: "Tree Map",
  spreadsheetId: WORK_SHEET_ID
};

const SNAPSHOT_PAYLOAD = cachedWorkLocationSnapshot as WorkLocationPayload;

const CITY_COORDINATES: Record<string, Coordinates> = {
  arlington: { lat: 32.7357, lng: -97.1081 },
  coppell: { lat: 32.9546, lng: -97.015 },
  dallas: { lat: 32.7767, lng: -96.797 },
  euless: { lat: 32.8371, lng: -97.0819 },
  frisco: { lat: 33.1507, lng: -96.8236 },
  irving: { lat: 32.814, lng: -96.9489 },
  "las colinas": { lat: 32.8959, lng: -96.9584 },
  mckinney: { lat: 33.1972, lng: -96.6398 },
  plano: { lat: 33.0198, lng: -96.6989 },
  richardson: { lat: 32.9483, lng: -96.7299 },
  wylie: { lat: 33.0151, lng: -96.5389 }
};

const LOCATION_COORDINATES: Record<string, Coordinates> = {
  "anderson bonner park, dallas": { lat: 32.9136, lng: -96.8195 },
  "beavers bend park, frisco": { lat: 33.1406, lng: -96.7859 },
  "bexar street, dallas": { lat: 32.7598, lng: -96.7566 },
  "berkner park, richardson": { lat: 32.9483, lng: -96.7299 },
  "breckinridge park, richardson": { lat: 32.9912, lng: -96.6259 },
  "buckhorn park, plano": { lat: 33.0244, lng: -96.7534 },
  "carpenter park, plano": { lat: 33.0692, lng: -96.7532 },
  "charles a gill elementary school, dallas": { lat: 32.8079, lng: -96.6751 },
  "citylab high school, dallas": { lat: 32.7803, lng: -96.7985 },
  "coppell nature park": { lat: 32.9823, lng: -96.9844 },
  "cottonwood park, richardson": { lat: 32.9529, lng: -96.7671 },
  "crowley park, richardson": { lat: 32.9814, lng: -96.6843 },
  "cummings park, dallas": { lat: 32.6923, lng: -96.8346 },
  "dallas college": { lat: 32.9215, lng: -96.7297 },
  "dallas college, richland campus": { lat: 32.9215, lng: -96.7297 },
  "earth bazaar and arts in bloom": { lat: 33.1976, lng: -96.6153 },
  "ferguson park, dallas": { lat: 32.7952, lng: -96.6956 },
  "fifa dallas": { lat: 32.7767, lng: -96.797 },
  "fifa frisco": { lat: 33.1507, lng: -96.8236 },
  "foxboro park, richardson": { lat: 32.9444, lng: -96.7041 },
  "fretz park, dallas": { lat: 32.9695, lng: -96.8058 },
  "frisco giveaway": { lat: 33.1507, lng: -96.8236 },
  "gabe nesbitt park, mckinney": { lat: 33.1722, lng: -96.7134 },
  "glendale park, dallas": { lat: 32.7034, lng: -96.8279 },
  "glenville park, richardson": { lat: 32.9438, lng: -96.7072 },
  "hoblitzelle park, plano": { lat: 33.0786, lng: -96.7513 },
  "huffhines park, richardson": { lat: 32.9625, lng: -96.7133 },
  "interurban park, main street, richardson": { lat: 32.9487, lng: -96.7351 },
  "irving": CITY_COORDINATES.irving,
  "irving and las colinas": { lat: 32.8578, lng: -96.9537 },
  "jericho village, wylie": { lat: 33.0117, lng: -96.5402 },
  "lake cliff park, dallas": { lat: 32.7442, lng: -96.8265 },
  "las colinas": CITY_COORDINATES["las colinas"],
  "lochwood park, dallas": { lat: 32.8476, lng: -96.6944 },
  "meadowstone park, dallas": { lat: 32.6776, lng: -96.7678 },
  "mckinney seed and plant swap": { lat: 33.1972, lng: -96.6398 },
  "mimosa park, richardson": { lat: 32.9642, lng: -96.7336 },
  "mockingbird elementary school, dallas": { lat: 32.8367, lng: -96.7666 },
  "monarch view park, frisco": { lat: 33.1873, lng: -96.8785 },
  "oak point park, plano": { lat: 33.0555, lng: -96.6685 },
  "prairie creek park, richardson": { lat: 32.9706, lng: -96.7307 },
  "robert cluck linear park, arlington": { lat: 32.7304, lng: -97.1061 },
  "rp brooks park, dallas": { lat: 32.7657, lng: -96.7101 },
  "salado park, dallas": { lat: 32.8276, lng: -96.6788 },
  "solar preparatory school, dallas": { lat: 32.8089, lng: -96.8061 },
  "sugarberry park": { lat: 32.8388, lng: -96.6463 },
  "terrace park, richardson": { lat: 32.9582, lng: -96.7208 },
  "usicoc native herb giveaway": { lat: 32.7767, lng: -96.797 },
  "william anderson elementary school, dallas": { lat: 32.6559, lng: -96.7848 },
  "woodhaven grove park, richardson": { lat: 32.9607, lng: -96.7239 },
  "wyndsor park, richardson": { lat: 32.9799, lng: -96.7421 }
};

function parseCsv(csv: string) {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    const nextCharacter = csv[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(field);
      field = "";
      if (row.some((value) => value.trim())) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += character;
  }

  row.push(field);
  if (row.some((value) => value.trim())) {
    rows.push(row);
  }

  return rows;
}

function recordsFromCsv(csv: string) {
  const [headerRow, ...dataRows] = parseCsv(csv);
  const headers = headerRow.map((header) => header.trim());

  return dataRows.map((dataRow) =>
    Object.fromEntries(headers.map((header, index) => [header, dataRow[index]?.trim() ?? ""]))
  ) as CsvRecord[];
}

function normalizeLocation(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\brchardson\b/g, "richardson")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/[.]/g, "")
    .replace(/,\s*$/g, "")
    .trim();
}

function normalizeNumber(value: string) {
  const normalized = value.replace(/[$,%\s,]/g, "");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSheetDate(value: string) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return new Date(
    Date.UTC(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate())
  )
    .toISOString()
    .slice(0, 10);
}

function inferDefaultCity(record: CsvRecord) {
  const locationAndEvent = normalizeLocation(`${record.Location} ${record["Event Name"]}`);
  const partners = normalizeLocation(record.Partners ?? "");
  const haystack = `${locationAndEvent} ${partners}`;
  const cityNames = Object.keys(CITY_COORDINATES);

  return (
    cityNames.find((city) => locationAndEvent.includes(city)) ??
    cityNames.find((city) => partners.includes(`city of ${city}`)) ??
    cityNames.find((city) => haystack.includes(city))
  );
}

function parseTrailingWorkCount(value: string) {
  const countMatch = value.match(
    /\s*,?\s+([\d,.]+)\s+(?:trees?|plants?|native plants)(?:\s+(?:planting|giveaway).*)?$/i
  );

  return countMatch ? normalizeNumber(countMatch[1]) : null;
}

function stripWorkCounts(value: string) {
  return value
    .replace(
      /\s*,?\s+[\d,.]+\s+(trees?|plants?|native plants)(?:\s+(?:planting|giveaway).*)?$/i,
      ""
    )
    .replace(/\s*,\s*$/g, "")
    .trim();
}

function splitListedPlantings(
  totalPlantings: number | null,
  locationCount: number,
  locationIndex: number
) {
  if (totalPlantings === null || locationCount <= 0) {
    return null;
  }

  if (!Number.isInteger(totalPlantings)) {
    return totalPlantings / locationCount;
  }

  const baseCount = Math.floor(totalPlantings / locationCount);
  const remainder = totalPlantings % locationCount;

  return baseCount + (locationIndex < remainder ? 1 : 0);
}

function splitLocationValue(value: string, defaultCity?: string) {
  const normalizedValue = value.trim();
  if (!normalizedValue || /^(miscellaneous|holiday giveaways)$/i.test(normalizedValue)) {
    return [];
  }

  const lines = normalizedValue.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const locations: LocationSplit[] = [];

  for (const rawLine of lines) {
    const listedPlantings = parseTrailingWorkCount(rawLine);
    const line = stripWorkCounts(rawLine);
    if (!line) {
      continue;
    }

    const compoundMatch = line.match(/^(.+?)\s+and\s+([^,]+),\s*([^,]+)$/i);

    if (compoundMatch) {
      const compoundLocations = [
        `${compoundMatch[1]}, ${compoundMatch[3]}`,
        `${compoundMatch[2]}, ${compoundMatch[3]}`
      ];

      compoundLocations.forEach((compoundLocation, index) => {
        locations.push({
          listedPlantings: splitListedPlantings(listedPlantings, compoundLocations.length, index),
          location: compoundLocation
        });
      });
      continue;
    }

    if (!line.includes(",") && defaultCity && !normalizeLocation(line).includes(defaultCity)) {
      locations.push({
        listedPlantings,
        location: `${line}, ${defaultCity.replace(/\b\w/g, (letter) => letter.toUpperCase())}`
      });
      continue;
    }

    locations.push({
      listedPlantings,
      location: line
    });
  }

  return locations;
}

function distributeMissingPlantings(locations: LocationSplit[], rowPlantings: number | null) {
  const listedTotal = locations.reduce(
    (total, location) => total + (location.listedPlantings ?? 0),
    0
  );
  const unlistedLocations = locations.filter((location) => location.listedPlantings === null);
  const remainingPlantings =
    rowPlantings === null ? null : Math.max(0, rowPlantings - listedTotal);

  let unlistedIndex = 0;

  return locations.map((location) => {
    if (location.listedPlantings !== null) {
      return {
        ...location,
        plantings: location.listedPlantings
      };
    }

    const plantings = splitListedPlantings(
      remainingPlantings,
      unlistedLocations.length,
      unlistedIndex
    );
    unlistedIndex += 1;

    return {
      ...location,
      plantings
    };
  });
}

function distributeRowValue(
  rowValue: number | null,
  rowPlantings: number | null,
  markerPlantings: number | null,
  locationCount: number
) {
  if (rowValue === null) {
    return null;
  }

  if (rowPlantings && markerPlantings !== null) {
    return rowValue * (markerPlantings / rowPlantings);
  }

  return locationCount > 0 ? rowValue / locationCount : rowValue;
}

function hashValue(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function jitterCoordinates(coordinates: Coordinates, seed: string) {
  const hash = hashValue(seed);
  const latOffset = ((hash % 1000) / 1000 - 0.5) * 0.045;
  const lngOffset = (((hash >> 10) % 1000) / 1000 - 0.5) * 0.045;

  return {
    lat: coordinates.lat + latOffset,
    lng: coordinates.lng + lngOffset
  };
}

function coordinatesForLocation(location: string, record: CsvRecord) {
  const normalizedLocation = normalizeLocation(location);
  const exactCoordinates = LOCATION_COORDINATES[normalizedLocation];
  const bareLocationCoordinates =
    LOCATION_COORDINATES[normalizedLocation.replace(/, [^,]+$/g, "")];

  if (exactCoordinates || bareLocationCoordinates) {
    return {
      ...(exactCoordinates ?? bareLocationCoordinates),
      estimated: false
    };
  }

  const city = inferDefaultCity({
    ...record,
    Location: `${location} ${record.Location}`
  });
  const cityCoordinates = city ? CITY_COORDINATES[city] : undefined;

  if (!cityCoordinates) {
    return null;
  }

  return {
    ...jitterCoordinates(cityCoordinates, `${record["Event Name"]}:${location}`),
    estimated: true
  };
}

function normalizeYear(record: CsvRecord) {
  const listedYear = normalizeNumber(record.Year);
  if (listedYear !== null && listedYear >= 1900 && listedYear <= 2100) {
    return listedYear;
  }

  const parsedDate = new Date(record.Date);
  const parsedYear = parsedDate.getUTCFullYear();

  return Number.isFinite(parsedYear) && parsedYear >= 1900 && parsedYear <= 2100
    ? parsedYear
    : null;
}

function markerFromRecord(record: CsvRecord, rowIndex: number) {
  const defaultCity = inferDefaultCity(record);
  const rowPlantings = normalizeNumber(record["# of Plantings"]);
  const rowExpense = normalizeNumber(record["Expense (USD)"]);
  const rowAirPollutants = normalizeNumber(record["Air Pollutants"]);
  const rowRainRunoff = normalizeNumber(record["Rain Runoff"]);
  const rowTreeCanopy = normalizeNumber(record["Tree Canopy"]);
  const rowVolunteerHours = normalizeNumber(record["# of Planting Volunteer Hours"]);
  const locations = distributeMissingPlantings(
    splitLocationValue(record.Location, defaultCity),
    rowPlantings
  );

  return locations.flatMap(({ location, plantings }, locationIndex) => {
    const coordinates = coordinatesForLocation(location, record);
    if (!coordinates) {
      return [];
    }

    return {
      airPollutants: distributeRowValue(
        rowAirPollutants,
        rowPlantings,
        plantings,
        locations.length
      ),
      category: record["Planting Category"] || "Other",
      co2Saved: null,
      date: record.Date,
      estimated: coordinates.estimated,
      eventName: record["Event Name"],
      expense: distributeRowValue(rowExpense, rowPlantings, plantings, locations.length),
      id: `${rowIndex}-${locationIndex}-${hashValue(`${record["Event Name"]}:${location}`)}`,
      lat: coordinates.lat,
      lng: coordinates.lng,
      location,
      paid: record.Paid,
      plantingDate: normalizeSheetDate(record.Date),
      partners: record.Partners,
      plantings,
      plantingLocations: normalizeNumber(record["# of Planting Locations"]),
      rainRunoff: distributeRowValue(rowRainRunoff, rowPlantings, plantings, locations.length),
      sourceLocation: record.Location,
      treeCanopy: distributeRowValue(rowTreeCanopy, rowPlantings, plantings, locations.length),
      volunteerHours: distributeRowValue(
        rowVolunteerHours,
        rowPlantings,
        plantings,
        locations.length
      ),
      year: normalizeYear(record)
    } satisfies WorkLocationMarker;
  });
}

function cachedWorkLocationPayload(warning: string): WorkLocationPayload {
  return {
    markers: SNAPSHOT_PAYLOAD.markers,
    skippedRows: SNAPSHOT_PAYLOAD.skippedRows,
    snapshot: true,
    source: SNAPSHOT_PAYLOAD.source ?? WORK_LOCATION_SOURCE,
    updatedAt: SNAPSHOT_PAYLOAD.updatedAt,
    warning
  };
}

export async function getWorkLocationMarkers(): Promise<WorkLocationPayload> {
  let response: Response;

  try {
    response = await fetch(TREE_MAP_CSV_URL, {
      headers: {
        "User-Agent": "OEOC-Earth-Web-Prototype/1.0"
      },
      next: {
        revalidate: 60 * 60
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown fetch error";

    return cachedWorkLocationPayload(
      `Live Google Tree Map CSV is unavailable (${message}); using cached snapshot.`
    );
  }

  if (!response.ok) {
    return cachedWorkLocationPayload(
      `Live Google Tree Map CSV returned HTTP ${response.status}; using cached snapshot.`
    );
  }

  const csv = await response.text();
  const records = recordsFromCsv(csv);
  const markerGroups = records.map((record, index) => markerFromRecord(record, index));
  const markers = markerGroups.flat();
  const skippedRows = markerGroups.filter((group) => group.length === 0).length;

  return {
    markers,
    skippedRows: Math.max(0, skippedRows),
    snapshot: false,
    source: WORK_LOCATION_SOURCE,
    updatedAt: new Date().toISOString()
  };
}
