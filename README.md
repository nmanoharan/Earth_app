# OEOC Earth

OEOC Earth is a web and iOS mobile map for exploring Google Earth Engine Dynamic World land-cover data across the United States.

This monorepo includes:

- `apps/web`: Next.js web app and API service for Earth Engine tiles, city/state search, timeline cache status, and tile caching.
- `apps/mobile`: Expo React Native app for iOS/TestFlight.
- `packages/shared`: shared layer labels, colors, and type definitions used by web and mobile.

## Current Version

- App version: `1.0.0`
- iOS build number: `6`
- GitHub repository: `https://github.com/nmanoharan/Earth_app`

## Features

- Interactive web and mobile maps.
- Google Dynamic World V1 data from Earth Engine.
- Tree cover, forest loss, and land-cover layers.
- City/state search with map recentering.
- Monthly historical date slider.
- Latest available data date is read from Earth Engine instead of assuming today's date.
- 12-month visible timeline window with one-year back/forward controls.
- Server-side tile cache with Redis/Memorystore support in Cloud Run.
- Local in-memory cache fallback for development.

## Local Run

Install dependencies at the repo root:

```bash
npm install
```

Start the web/API app:

```bash
npm run dev:web
```

The web app usually starts at `http://localhost:3000`. If that port is busy, Next.js will choose the next open port.

Start the mobile dev server:

```bash
cd apps/mobile
EXPO_PUBLIC_TILE_API_BASE_URL=http://127.0.0.1:3000 npx expo start --dev-client --host lan
```

Run the iOS app:

```bash
cd apps/mobile
EXPO_PUBLIC_TILE_API_BASE_URL=http://127.0.0.1:3000 npm run ios
```

If the web/API app is running on a different port, update `EXPO_PUBLIC_TILE_API_BASE_URL` to match.

## Environment

Use `.env.local` files for local values. Never commit real credentials.

Web/API:

```bash
EE_PROJECT=green-earth-497718
TILE_CACHE_BACKEND=memory
```

Cloud Run adds production values for Redis and mobile API authorization.

Mobile:

```bash
EXPO_PUBLIC_TILE_API_BASE_URL=https://forest-cover-web-661122226827.us-central1.run.app
EXPO_PUBLIC_MOBILE_API_TOKEN=replace-with-cloud-run-mobile-api-token
```

## Google Earth Engine

For local development, authenticate Application Default Credentials with Earth Engine scopes:

```bash
gcloud auth application-default login --scopes=https://www.googleapis.com/auth/earthengine,https://www.googleapis.com/auth/cloud-platform
```

Then verify:

```bash
curl http://localhost:3000/api/earth-engine/status
```

The response should include `"configured": true` and a `latestAvailableDate`.

## Deployment

Web/API is deployed to Google Cloud Run as `forest-cover-web`.

Mobile iOS builds are deployed through Expo EAS:

```bash
cd apps/mobile
EAS_BUILD_NO_EXPO_GO_WARNING=true npx eas-cli build --platform ios --profile production --auto-submit --clear-cache --non-interactive
```

The production EAS profile auto-increments the iOS build number.

## GitHub Versioning

Going forward:

1. Make changes in the monorepo.
2. Run mobile and web type checks.
3. Confirm no real secrets are present in source files.
4. Commit to `main`.
5. Push to `origin`.
6. Tag release baselines with `v<app-version>-build.<ios-build-number>`, for example `v1.0.0-build.6`.

Suggested checks:

```bash
npx tsc -p apps/web/tsconfig.json --noEmit --incremental false
npx tsc -p apps/mobile/tsconfig.json --noEmit
```
