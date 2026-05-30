# Google Cloud Tile Cache Plan

## Goal

Move Earth Engine tile byte caching out of the Next.js process and into a managed Google Cloud in-memory cache. The web app keeps a small local memory cache for development, but production should use Memorystore for Redis through Cloud Run private networking.

## Runtime Architecture

1. Browser requests `/api/earth-engine/tiles`.
2. The Next.js API route checks the tile cache by key:
   `layerId:date:z:x:y`.
3. If Redis has the tile, the API returns it immediately with:
   `X-Server-Tile-Cache: hit`.
4. If Redis misses, the API fetches the tile from Earth Engine, writes the bytes to Redis with a TTL, and returns:
   `X-Server-Tile-Cache: miss`.
5. If Redis is not configured, local development uses a capped in-process cache.

## Recommended Google Cloud Services

- Cloud Run for the web/API service.
- Memorystore for Redis as the shared in-memory tile cache.
- Direct VPC egress from Cloud Run to the VPC that hosts Memorystore.
- Optional later: Cloud CDN in front of the tile API for public, non-sensitive cached tile responses.

Google currently recommends Direct VPC egress for Cloud Run to Memorystore because it avoids managed connector instances and can reduce latency/cost. Serverless VPC Access is still an alternative when Direct VPC egress is not available in the target setup.

## App Environment

Required for Earth Engine:

```bash
EE_PROJECT=green-earth-497718
```

Production Redis cache:

```bash
TILE_CACHE_BACKEND=redis
REDISHOST=MEMORYSTORE_PRIVATE_IP
REDISPORT=6379
TILE_CACHE_TTL_SECONDS=604800
```

Alternative single URL:

```bash
TILE_CACHE_REDIS_URL=redis://MEMORYSTORE_PRIVATE_IP:6379
```

Local/fallback memory cap:

```bash
TILE_CACHE_BACKEND=memory
TILE_CACHE_MEMORY_MAX_BYTES=25165824
TILE_CACHE_MEMORY_MAX_ENTRIES=240
```

Disable tile byte caching entirely:

```bash
TILE_CACHE_BACKEND=none
```

## Example Provisioning Flow

Set these first:

```bash
PROJECT_ID=green-earth-497718
REGION=us-central1
NETWORK=default
SUBNET=default
CACHE_ID=forest-tile-cache
```

Enable services:

```bash
gcloud services enable run.googleapis.com redis.googleapis.com vpcaccess.googleapis.com
```

Create the Memorystore instance:

```bash
gcloud redis instances create "$CACHE_ID" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --network "$NETWORK" \
  --size 1 \
  --redis-version redis_7_0
```

Read the private IP:

```bash
REDIS_IP=$(gcloud redis instances describe "$CACHE_ID" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format "value(host)")
```

Deploy Cloud Run with Direct VPC egress and cache env vars:

```bash
gcloud run deploy forest-cover-web \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --source . \
  --network "$NETWORK" \
  --subnet "$SUBNET" \
  --set-env-vars "EE_PROJECT=$PROJECT_ID,TILE_CACHE_BACKEND=redis,REDISHOST=$REDIS_IP,REDISPORT=6379,TILE_CACHE_TTL_SECONDS=604800"
```

## Verification

Check app status:

```bash
curl https://YOUR_CLOUD_RUN_URL/api/earth-engine/status
```

Expected `tileCache` shape:

```json
{
  "backend": "redis",
  "redisConfigured": true,
  "ttlSeconds": 604800
}
```

Check a tile twice:

```bash
curl -I "https://YOUR_CLOUD_RUN_URL/api/earth-engine/tiles?layerId=landCover&date=2026-05-28&z=4&x=3&y=6"
```

The first successful request should show `X-Server-Tile-Cache: miss`. The second should show `X-Server-Tile-Cache: hit`.
