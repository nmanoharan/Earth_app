# US Forest Cover Explorer (Web + Mobile Prototype)

This monorepo includes:

- A Vercel-ready Next.js web app (`apps/web`)
- An Expo mobile app (`apps/mobile`)
- A shared package for common map layers and mock data (`packages/shared`)

## Included in this prototype

- Interactive map of the U.S.
- Zoom in / zoom out controls
- Layer toggles:
  - Tree Cover
  - Forest Loss
  - Land Cover
- Year slider (UI wired for future time-series data)
- API route for layer metadata in web app:
  - `GET /api/layers`
- Shared data contract consumed by both web and mobile clients.

## Tech stack

- Next.js (App Router) + Vercel
- Expo + React Native
- TypeScript
- React Leaflet (web)
- React Native Maps (mobile)

## Local run

1. Install dependencies at repo root:
   - `npm install`
2. Start web app:
   - `npm run dev:web`
3. Start mobile app:
   - `npm run dev:mobile`
4. Open web:
   - `http://localhost:3000`
5. Open mobile:
   - Use Expo QR / simulator from CLI.

## Deploy web on Vercel

1. Push this repository to Git.
2. Import in Vercel.
3. Set root directory to `apps/web`.
4. Build command: `npm run build`.
5. Output: default Next.js output.
5. Deploy.

## Next step to connect real Google Earth Engine data

Replace mock layer geometry in `packages/shared/src/mockGeo.ts` with:

- precomputed raster/vector tiles exported from Earth Engine
- dynamic API responses from server routes (`apps/web/src/app/api/*`)

Recommended datasets:

- Dynamic World V1 (`GOOGLE/DYNAMICWORLD/V1`)
- Hansen Global Forest Change (`UMD/hansen/global_forest_change_2024_v1_12`)
