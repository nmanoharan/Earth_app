import { NextResponse } from "next/server";

type SearchResult = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  zoom: number;
  type: "state" | "city";
};

const stateCenters: Array<SearchResult & { aliases: string[] }> = [
  { id: "AL", label: "Alabama", lat: 32.8067, lng: -86.7911, zoom: 7, type: "state", aliases: ["al", "alabama"] },
  { id: "AK", label: "Alaska", lat: 64.2008, lng: -149.4937, zoom: 4, type: "state", aliases: ["ak", "alaska"] },
  { id: "AZ", label: "Arizona", lat: 34.0489, lng: -111.0937, zoom: 7, type: "state", aliases: ["az", "arizona"] },
  { id: "AR", label: "Arkansas", lat: 35.201, lng: -91.8318, zoom: 7, type: "state", aliases: ["ar", "arkansas"] },
  { id: "CA", label: "California", lat: 36.7783, lng: -119.4179, zoom: 6, type: "state", aliases: ["ca", "california"] },
  { id: "CO", label: "Colorado", lat: 39.5501, lng: -105.7821, zoom: 7, type: "state", aliases: ["co", "colorado"] },
  { id: "CT", label: "Connecticut", lat: 41.6032, lng: -73.0877, zoom: 8, type: "state", aliases: ["ct", "connecticut"] },
  { id: "DE", label: "Delaware", lat: 38.9108, lng: -75.5277, zoom: 8, type: "state", aliases: ["de", "delaware"] },
  { id: "DC", label: "Washington, DC", lat: 38.9072, lng: -77.0369, zoom: 10, type: "state", aliases: ["dc", "district of columbia", "washington dc", "washington, dc"] },
  { id: "FL", label: "Florida", lat: 27.6648, lng: -81.5158, zoom: 6, type: "state", aliases: ["fl", "florida"] },
  { id: "GA", label: "Georgia", lat: 32.1656, lng: -82.9001, zoom: 7, type: "state", aliases: ["ga", "georgia"] },
  { id: "HI", label: "Hawaii", lat: 19.8968, lng: -155.5828, zoom: 7, type: "state", aliases: ["hi", "hawaii"] },
  { id: "ID", label: "Idaho", lat: 44.0682, lng: -114.742, zoom: 6, type: "state", aliases: ["id", "idaho"] },
  { id: "IL", label: "Illinois", lat: 40.6331, lng: -89.3985, zoom: 7, type: "state", aliases: ["il", "illinois"] },
  { id: "IN", label: "Indiana", lat: 40.2672, lng: -86.1349, zoom: 7, type: "state", aliases: ["in", "indiana"] },
  { id: "IA", label: "Iowa", lat: 41.878, lng: -93.0977, zoom: 7, type: "state", aliases: ["ia", "iowa"] },
  { id: "KS", label: "Kansas", lat: 39.0119, lng: -98.4842, zoom: 7, type: "state", aliases: ["ks", "kansas"] },
  { id: "KY", label: "Kentucky", lat: 37.8393, lng: -84.27, zoom: 7, type: "state", aliases: ["ky", "kentucky"] },
  { id: "LA", label: "Louisiana", lat: 30.9843, lng: -91.9623, zoom: 7, type: "state", aliases: ["la", "louisiana"] },
  { id: "ME", label: "Maine", lat: 45.2538, lng: -69.4455, zoom: 7, type: "state", aliases: ["me", "maine"] },
  { id: "MD", label: "Maryland", lat: 39.0458, lng: -76.6413, zoom: 8, type: "state", aliases: ["md", "maryland"] },
  { id: "MA", label: "Massachusetts", lat: 42.4072, lng: -71.3824, zoom: 8, type: "state", aliases: ["ma", "massachusetts"] },
  { id: "MI", label: "Michigan", lat: 44.3148, lng: -85.6024, zoom: 6, type: "state", aliases: ["mi", "michigan"] },
  { id: "MN", label: "Minnesota", lat: 46.7296, lng: -94.6859, zoom: 6, type: "state", aliases: ["mn", "minnesota"] },
  { id: "MS", label: "Mississippi", lat: 32.3547, lng: -89.3985, zoom: 7, type: "state", aliases: ["ms", "mississippi"] },
  { id: "MO", label: "Missouri", lat: 37.9643, lng: -91.8318, zoom: 7, type: "state", aliases: ["mo", "missouri"] },
  { id: "MT", label: "Montana", lat: 46.8797, lng: -110.3626, zoom: 6, type: "state", aliases: ["mt", "montana"] },
  { id: "NE", label: "Nebraska", lat: 41.4925, lng: -99.9018, zoom: 7, type: "state", aliases: ["ne", "nebraska"] },
  { id: "NV", label: "Nevada", lat: 38.8026, lng: -116.4194, zoom: 6, type: "state", aliases: ["nv", "nevada"] },
  { id: "NH", label: "New Hampshire", lat: 43.1939, lng: -71.5724, zoom: 8, type: "state", aliases: ["nh", "new hampshire"] },
  { id: "NJ", label: "New Jersey", lat: 40.0583, lng: -74.4057, zoom: 8, type: "state", aliases: ["nj", "new jersey"] },
  { id: "NM", label: "New Mexico", lat: 34.9727, lng: -105.0324, zoom: 7, type: "state", aliases: ["nm", "new mexico"] },
  { id: "NY", label: "New York", lat: 43.2994, lng: -74.2179, zoom: 7, type: "state", aliases: ["ny", "new york"] },
  { id: "NC", label: "North Carolina", lat: 35.7596, lng: -79.0193, zoom: 7, type: "state", aliases: ["nc", "north carolina"] },
  { id: "ND", label: "North Dakota", lat: 47.5515, lng: -101.002, zoom: 7, type: "state", aliases: ["nd", "north dakota"] },
  { id: "OH", label: "Ohio", lat: 40.4173, lng: -82.9071, zoom: 7, type: "state", aliases: ["oh", "ohio"] },
  { id: "OK", label: "Oklahoma", lat: 35.0078, lng: -97.0929, zoom: 7, type: "state", aliases: ["ok", "oklahoma"] },
  { id: "OR", label: "Oregon", lat: 43.8041, lng: -120.5542, zoom: 7, type: "state", aliases: ["or", "oregon"] },
  { id: "PA", label: "Pennsylvania", lat: 41.2033, lng: -77.1945, zoom: 7, type: "state", aliases: ["pa", "pennsylvania"] },
  { id: "RI", label: "Rhode Island", lat: 41.5801, lng: -71.4774, zoom: 9, type: "state", aliases: ["ri", "rhode island"] },
  { id: "SC", label: "South Carolina", lat: 33.8361, lng: -81.1637, zoom: 7, type: "state", aliases: ["sc", "south carolina"] },
  { id: "SD", label: "South Dakota", lat: 43.9695, lng: -99.9018, zoom: 7, type: "state", aliases: ["sd", "south dakota"] },
  { id: "TN", label: "Tennessee", lat: 35.5175, lng: -86.5804, zoom: 7, type: "state", aliases: ["tn", "tennessee"] },
  { id: "TX", label: "Texas", lat: 31.9686, lng: -99.9018, zoom: 6, type: "state", aliases: ["tx", "texas"] },
  { id: "UT", label: "Utah", lat: 39.321, lng: -111.0937, zoom: 7, type: "state", aliases: ["ut", "utah"] },
  { id: "VT", label: "Vermont", lat: 44.5588, lng: -72.5778, zoom: 8, type: "state", aliases: ["vt", "vermont"] },
  { id: "VA", label: "Virginia", lat: 37.4316, lng: -78.6569, zoom: 7, type: "state", aliases: ["va", "virginia"] },
  { id: "WA", label: "Washington", lat: 47.7511, lng: -120.7401, zoom: 7, type: "state", aliases: ["wa", "washington"] },
  { id: "WV", label: "West Virginia", lat: 38.5976, lng: -80.4549, zoom: 7, type: "state", aliases: ["wv", "west virginia"] },
  { id: "WI", label: "Wisconsin", lat: 43.7844, lng: -88.7879, zoom: 7, type: "state", aliases: ["wi", "wisconsin"] },
  { id: "WY", label: "Wyoming", lat: 43.076, lng: -107.2903, zoom: 7, type: "state", aliases: ["wy", "wyoming"] }
];

function normalizeQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function searchCities(query: string): Promise<SearchResult[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("dedupe", "1");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "US-Dynamic-World-Land-Cover-Explorer-Prototype/0.1"
    },
    next: { revalidate: 86400 }
  });

  if (!response.ok) {
    return [];
  }

  const places = (await response.json()) as Array<{
    place_id: number;
    display_name: string;
    lat: string;
    lon: string;
    address?: {
      city?: string;
      town?: string;
      village?: string;
      municipality?: string;
      state?: string;
    };
    type?: string;
  }>;

  return places
    .map((place) => {
      const city =
        place.address?.city ??
        place.address?.town ??
        place.address?.village ??
        place.address?.municipality ??
        place.display_name.split(",")[0];
      const state = place.address?.state;

      return {
        id: String(place.place_id),
        label: state ? `${city}, ${state}` : place.display_name,
        lat: Number(place.lat),
        lng: Number(place.lon),
        zoom: 11,
        type: "city" as const
      };
    })
    .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = normalizeQuery(searchParams.get("q") ?? "");

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const stateMatch = stateCenters.find((state) => state.aliases.includes(query));
  if (stateMatch) {
    const { aliases: _aliases, ...result } = stateMatch;
    return NextResponse.json({ results: [result] });
  }

  const cityResults = await searchCities(query);
  return NextResponse.json({ results: cityResults });
}
