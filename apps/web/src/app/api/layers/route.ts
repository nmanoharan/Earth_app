import { NextResponse } from "next/server";
import { forestLayerConfigs } from "@forest/shared";
import { authorizeMobileApiRequest } from "@/lib/mobileApiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorizedResponse = authorizeMobileApiRequest(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  return NextResponse.json({
    source: "google-earth-engine-dynamic-world-v1",
    layers: forestLayerConfigs
  });
}
