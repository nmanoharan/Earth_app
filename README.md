# OEOC Environmental Impact Dashboard

This repository contains the One Earth One Chance environmental impact dashboard. The current web app maps OEOC work locations, summarizes yearly impact, and exports planting and event reports from the OEOC Tree Map data.

Production:

- Dashboard: `https://oeoc-dashboard.vercel.app/oeoc-impact`
- Help documentation: `https://oeoc-dashboard.vercel.app/oeoc-impact/help`
- GitHub repository: `https://github.com/nmanoharan/Earth_app`

## What Is Included

- `apps/web`: Next.js web app for the OEOC dashboard, help documentation, map, charts, and export APIs.
- `apps/web/src/app/oeoc-impact`: dashboard route.
- `apps/web/src/app/oeoc-impact/help`: non-technical help, formulas, assumptions, citations, and export instructions.
- `apps/web/src/app/api/work-locations`: work-location data and export endpoints.
- `apps/web/src/lib/impactCalculations.ts`: shared impact calculation constants and formulas.
- `apps/web/src/lib/workLocations.ts`: Google Sheet CSV parsing, geocoding fallbacks, and cached snapshot fallback.
- `apps/web/src/data/work-location-markers.snapshot.json`: bundled fallback snapshot used when the live Google CSV is unavailable.

## Main Features

- Interactive DFW-centered map of OEOC work locations.
- Marker colors aligned with yearly chart categories.
- Location popups with planting, canopy, partner, and impact details.
- Yearly charts for:
  - CO2 Removed
  - Air Pollutants Removed
  - Runoff Avoided
  - Cost Savings
- Graph info panels explaining estimates and source assumptions.
- Help documentation written for non-technical users.
- Export by planting city/location/year to Excel.
- Export selected event to a styled PDF report.

## Exports

The dashboard intentionally keeps only two exports:

1. Planting Excel export
   - Grouped by year.
   - Includes City and Planting Location.
   - Includes event names, planting dates, category, partners, plantings, canopy, impact metrics, costs, volunteer hours, expenses, latitude, longitude, and approximate-location flag.

2. Event PDF export
   - Controlled only by the `PDF Event` dropdown.
   - Produces a styled one-event impact report.

The older raw all-data Excel export was removed.

## Calculation Notes

All formulas and assumptions are documented in the app at `/oeoc-impact/help`.

High-level calculation flow:

1. Read the Tree Map sheet or fallback snapshot.
2. Use planting count when available.
3. If planting count is missing, convert canopy to planting equivalent using `1,500 sq ft` per tree.
4. Calculate months active from planting date to estimate date.
5. Use sheet-provided annual values when available.
6. Use EPA/i-Tree/USFS fallback estimates when sheet values are missing.
7. Prorate annual values by months active / 12.
8. Continue counting prior-year plantings as active contributors in later years.

The dashboard uses pounds, gallons, square feet, counts, and USD in the user interface.

## Local Run

Install dependencies at the repo root:

```bash
npm install
```

Start the web app:

```bash
npm run dev:web -- -- -p 3006
```

Open:

```text
http://localhost:3006/oeoc-impact
http://localhost:3006/oeoc-impact/help
```

## Build

```bash
npm run build:web
```

## Deployment

The current OEOC dashboard is deployed to Vercel as `oeoc-dashboard`.

```bash
npx vercel --prod --yes
```

Vercel settings are in:

- `vercel.json`
- `.vercelignore`

Environment files and credentials are ignored and must not be committed.

## Data Source

The app reads OEOC Tree Map data from the configured Google Sheet CSV export when available. If the live sheet is unavailable, it uses the bundled cached snapshot so the dashboard can still load.

## Source Citations

The help page links to the public sources used for calculation methodology, including EPA greenhouse gas equivalencies, EPA tree and vegetation benefits, EPA BenMAP, i-Tree methods and references, and USFS shade-related planning studies.

## GitHub Versioning

Recommended workflow:

1. Make changes locally.
2. Run `npm run build:web`.
3. Confirm no real secrets are present in source files.
4. Commit to `main`.
5. Push to `origin`.
