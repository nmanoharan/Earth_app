import { NextResponse } from "next/server";
import { getWorkLocationMarkers } from "@/lib/workLocations";
import { authorizeMobileApiRequest } from "@/lib/mobileApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorizedResponse = authorizeMobileApiRequest(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  try {
    return NextResponse.json(await getWorkLocationMarkers());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load work locations from the Tree Map sheet."
      },
      { status: 503 }
    );
  }
}
