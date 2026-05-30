import { NextResponse } from "next/server";
import {
  dynamicWorldMetadata,
  getEarthEngineConfigStatus,
  getDynamicWorldTileCacheStatus,
  getLatestDynamicWorldDate
} from "@/lib/earthEngine";
import { authorizeMobileApiRequest } from "@/lib/mobileApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorizedResponse = authorizeMobileApiRequest(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const configStatus = await getEarthEngineConfigStatus();
  let latestAvailableDate: string | undefined;
  let latestAvailableDateError: string | undefined;

  if (configStatus.configured) {
    try {
      latestAvailableDate = await getLatestDynamicWorldDate();
    } catch (error) {
      latestAvailableDateError =
        error instanceof Error ? error.message : "Unable to read the latest Dynamic World date.";
    }
  }

  return NextResponse.json({
    ...configStatus,
    ...dynamicWorldMetadata,
    tileCache: getDynamicWorldTileCacheStatus(),
    earliestAvailableDate: dynamicWorldMetadata.minDate,
    latestAvailableDate,
    latestAvailableDateError
  });
}
