import { NextRequest, NextResponse } from "next/server";
import { type ForestLayerId } from "@forest/shared";
import {
  dynamicWorldMetadata,
  getDynamicWorldTimelineDateLayerCache,
  getLatestDynamicWorldDate,
  warmDynamicWorldTimelineDate
} from "@/lib/earthEngine";
import { authorizeMobileApiRequest } from "@/lib/mobileApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_TIMELINE_LAYERS: ForestLayerId[] = ["treeCover", "forestLoss"];
const VALID_LAYER_IDS = new Set<ForestLayerId>(["treeCover", "forestLoss", "landCover"]);

function isDateValue(value?: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function parseDateValue(value: string) {
  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsedDate.getTime())
    ? new Date(`${dynamicWorldMetadata.minDate}T00:00:00.000Z`)
    : parsedDate;
}

function formatDateValue(date: Date) {
  return date.toISOString().slice(0, 10);
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

function minDate(firstDate: string, secondDate: string) {
  return firstDate <= secondDate ? firstDate : secondDate;
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

function parseLayers(value: string | null) {
  const requestedLayers = value
    ?.split(",")
    .map((layerId) => layerId.trim())
    .filter(Boolean) as ForestLayerId[] | undefined;
  const layers = requestedLayers?.length ? requestedLayers : DEFAULT_TIMELINE_LAYERS;
  const validLayers = layers.filter((layerId) => VALID_LAYER_IDS.has(layerId));

  return validLayers.length > 0 ? validLayers : DEFAULT_TIMELINE_LAYERS;
}

async function timelineCachePayload({
  endDate,
  layers,
  startDate
}: {
  endDate: string;
  layers: ForestLayerId[];
  startDate: string;
}) {
  const timelineDates = buildMonthlyTimelineDates(startDate, endDate);
  const layersByDate = await getDynamicWorldTimelineDateLayerCache(timelineDates);
  const readyDates = timelineDates.filter((date) =>
    layers.every((layerId) => layersByDate[date]?.includes(layerId))
  );
  const readyDateSet = new Set(readyDates);
  const enabledDates: string[] = [];

  for (let index = timelineDates.length - 1; index >= 0; index -= 1) {
    const date = timelineDates[index];
    if (!readyDateSet.has(date)) {
      break;
    }

    enabledDates.unshift(date);
  }

  return {
    complete: readyDates.length === timelineDates.length && timelineDates.length > 0,
    enabledDates,
    endDate,
    layers,
    progress:
      timelineDates.length > 0 ? Math.round((readyDates.length / timelineDates.length) * 100) : 0,
    readyCount: readyDates.length,
    readyDates,
    startDate,
    totalCount: timelineDates.length
  };
}

async function requestDates(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const latestDate = await getLatestDynamicWorldDate();
  const startDate = isDateValue(searchParams.get("startDate"))
    ? searchParams.get("startDate")!
    : dynamicWorldMetadata.minDate;
  const endDate = isDateValue(searchParams.get("endDate"))
    ? searchParams.get("endDate")!
    : latestDate;

  return {
    endDate: clampDate(endDate, dynamicWorldMetadata.minDate, latestDate),
    layers: parseLayers(searchParams.get("layers")),
    startDate: minDate(
      clampDate(startDate, dynamicWorldMetadata.minDate, latestDate),
      clampDate(endDate, dynamicWorldMetadata.minDate, latestDate)
    )
  };
}

export async function GET(request: NextRequest) {
  const unauthorizedResponse = authorizeMobileApiRequest(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const { endDate, layers, startDate } = await requestDates(request);

  return NextResponse.json(await timelineCachePayload({ endDate, layers, startDate }));
}

export async function POST(request: NextRequest) {
  const unauthorizedResponse = authorizeMobileApiRequest(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const { endDate, layers, startDate } = await requestDates(request);
  const beforeWarm = await timelineCachePayload({ endDate, layers, startDate });
  const readyDateSet = new Set(beforeWarm.readyDates);
  const timelineDates = buildMonthlyTimelineDates(startDate, endDate);
  const warmed: Array<{
    cacheStatus?: string;
    contentType: string;
    date: string;
    layerId: ForestLayerId;
    status: number;
  }> = [];

  for (let index = timelineDates.length - 1; index >= 0; index -= 1) {
    const date = timelineDates[index];
    if (readyDateSet.has(date)) {
      continue;
    }

    const cachedLayers = beforeWarm.readyDates.includes(date)
      ? layers
      : (await getDynamicWorldTimelineDateLayerCache([date]))[date] ?? [];
    const missingLayer = layers.find((layerId) => !cachedLayers.includes(layerId));

    if (!missingLayer) {
      continue;
    }

    try {
      const missingLayers = layers.filter((layerId) => !cachedLayers.includes(layerId));

      warmed.push(
        ...(await Promise.all(
          missingLayers.map((layerId) =>
            warmDynamicWorldTimelineDate({
              date,
              layerId
            })
          )
        ))
      );
    } catch (error) {
      return NextResponse.json(
        {
          ...beforeWarm,
          warmError: error instanceof Error ? error.message : "Timeline cache warm failed.",
          warming: {
            date,
            layerId: missingLayer
          }
        },
        { status: 202 }
      );
    }

    break;
  }

  const nextPayload = await timelineCachePayload({ endDate, layers, startDate });

  return NextResponse.json({
    ...nextPayload,
    warmed,
    warmedCount: warmed.length
  });
}
