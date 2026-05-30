import { NextResponse } from "next/server";
import { forestLayerConfigs } from "@forest/shared";

export async function GET() {
  return NextResponse.json({
    source: "google-earth-engine-dynamic-world-v1",
    layers: forestLayerConfigs
  });
}
