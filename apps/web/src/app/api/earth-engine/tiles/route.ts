import { NextRequest, NextResponse } from "next/server";
import { getDynamicWorldTile, getDynamicWorldTileCacheStatus } from "@/lib/earthEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseTileNumber(value: string | null) {
  const tileNumber = Number(value);
  return Number.isInteger(tileNumber) ? tileNumber : Number.NaN;
}

function dateFromRequest(value: string | null, fallbackYear: number) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return Number.isInteger(fallbackYear) ? `${fallbackYear}-09-15` : "";
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const layerId = searchParams.get("layerId");
  const year = parseTileNumber(searchParams.get("year"));
  const date = dateFromRequest(searchParams.get("date"), year);
  const z = parseTileNumber(searchParams.get("z"));
  const x = parseTileNumber(searchParams.get("x"));
  const y = parseTileNumber(searchParams.get("y"));

  if (![z, x, y].every(Number.isInteger) || !date) {
    return NextResponse.json({ error: "Invalid tile coordinates." }, { status: 400 });
  }

  try {
    const tile = await getDynamicWorldTile({
      date,
      layerId,
      x,
      y,
      z
    });
    const headers: Record<string, string> = {
      "Cache-Control":
        tile.status === 200 ? "public, max-age=604800, stale-while-revalidate=86400" : "no-store",
      "Content-Type": tile.contentType,
      "X-Server-Tile-Cache-Backend": getDynamicWorldTileCacheStatus().backend
    };

    if (tile.cacheStatus) {
      headers["X-Server-Tile-Cache"] = tile.cacheStatus;
    }

    const responseBody = new ArrayBuffer(tile.body.byteLength);
    new Uint8Array(responseBody).set(tile.body);

    return new NextResponse(responseBody, {
      status: tile.status,
      headers
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Earth Engine tile request failed.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
