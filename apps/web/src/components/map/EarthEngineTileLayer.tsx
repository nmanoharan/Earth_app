"use client";

import L, { type Coords, type DoneCallback, type GridLayerOptions } from "leaflet";
import { useCallback, useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { type ForestLayerId } from "@forest/shared";

type TileStatus = "loaded" | "error";
type TileQueueTask = {
  canceled: boolean;
  key: string;
  priority: number;
  start: () => void;
  started: boolean;
};

type TileLoadTicket = {
  cancel: () => void;
  complete: () => void;
  setPriority: (priority: number) => void;
};

type ManagedLayer = {
  layer: L.GridLayer;
  disposed: boolean;
  loaded: boolean;
  reportTileStatus: boolean;
  loadedTiles: number;
  errorTiles: number;
  reportedLoadedTiles: number;
  reportedErrorTiles: number;
  tileLoads: Set<TileLoadTicket>;
  date?: string;
};

const FADE_DURATION_MS = 1000;
const PRELOAD_AFTER_ACTIVE_DELAY_MS = 1500;
const PRELOAD_FALLBACK_MS = 15000;
const TRANSITION_FALLBACK_MS = 8000;
const PRELOAD_MAX_ZOOM = 10;
const TILE_RETRY_DELAYS_MS = [5000];
const MAX_PARALLEL_TILE_LOADS_PER_LAYER_DATE = 2;
const TILE_QUEUE_PRIORITY_ACTIVE = 0;
const TILE_QUEUE_PRIORITY_PRELOAD = 1;
const DYNAMIC_WORLD_MIN_DATE = "2015-06-27";

const tileQueues = new Map<string, TileQueueTask[]>();
let activeTileQueueKey: string | null = null;
let activeTileLoads = 0;

type EarthEngineTileLayerProps = {
  date: string;
  layerId: ForestLayerId;
  opacity: number;
  preloadMaxDate?: string;
  preloadMinDate?: string;
  zIndex: number;
  onTileStatus?: (layerId: ForestLayerId, status: TileStatus) => void;
};

function buildTileUrl({
  coords,
  date,
  layerId,
}: {
  coords: Coords;
  date: string;
  layerId: ForestLayerId;
}) {
  const params = new URLSearchParams({
    date,
    layerId,
    x: String(coords.x),
    y: String(coords.y),
    z: String(coords.z)
  });

  return `/api/earth-engine/tiles?${params.toString()}`;
}

function buildTileQueueKey(layerId: ForestLayerId, date: string) {
  return `${layerId}:${date}`;
}

function addDays(date: string, days: number) {
  const parsedDate = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? `${date}T00:00:00.000Z`
      : `${DYNAMIC_WORLD_MIN_DATE}T00:00:00.000Z`
  );
  if (Number.isNaN(parsedDate.getTime())) {
    return DYNAMIC_WORLD_MIN_DATE;
  }

  parsedDate.setUTCDate(parsedDate.getUTCDate() + days);
  return parsedDate.toISOString().slice(0, 10);
}

function applyLayerTransition(layer: L.GridLayer) {
  const container = layer.getContainer();
  if (container) {
    container.style.transition = `opacity ${FADE_DURATION_MS}ms ease`;
    container.style.willChange = "opacity";
  }
}

function getNextTileQueueKey() {
  let selectedKey: string | null = null;
  let selectedPriority = Number.POSITIVE_INFINITY;

  for (const [key, queue] of tileQueues) {
    const pendingQueue = queue.filter((task) => !task.canceled);

    if (pendingQueue.length === 0) {
      tileQueues.delete(key);
      continue;
    }

    if (pendingQueue.length !== queue.length) {
      tileQueues.set(key, pendingQueue);
    }

    const queuePriority = Math.min(...pendingQueue.map((task) => task.priority));
    if (queuePriority < selectedPriority) {
      selectedKey = key;
      selectedPriority = queuePriority;

      if (queuePriority === TILE_QUEUE_PRIORITY_ACTIVE) {
        break;
      }
    }
  }

  return selectedKey;
}

function flushTileQueue() {
  if (activeTileLoads === 0) {
    activeTileQueueKey = getNextTileQueueKey();
  }

  if (!activeTileQueueKey) {
    return;
  }

  const activeQueue = tileQueues.get(activeTileQueueKey);
  if (!activeQueue) {
    if (activeTileLoads === 0) {
      activeTileQueueKey = null;
      flushTileQueue();
    }
    return;
  }

  while (activeTileLoads < MAX_PARALLEL_TILE_LOADS_PER_LAYER_DATE && activeQueue.length > 0) {
    const task = activeQueue.shift();
    if (!task || task.canceled) {
      continue;
    }

    task.started = true;
    activeTileLoads += 1;
    task.start();
  }

  if (activeQueue.length === 0) {
    tileQueues.delete(activeTileQueueKey);
  }

  if (activeTileLoads === 0) {
    activeTileQueueKey = null;
    flushTileQueue();
  }
}

function enqueueTileLoad(key: string, start: () => void, priority: number): TileLoadTicket {
  const task: TileQueueTask = {
    canceled: false,
    key,
    priority,
    start,
    started: false
  };
  let completed = false;
  const queue = tileQueues.get(key) ?? [];

  queue.push(task);
  tileQueues.set(key, queue);
  setTimeout(flushTileQueue, 0);

  const finish = () => {
    if (completed) {
      return;
    }

    completed = true;
    task.canceled = true;

    if (task.started) {
      activeTileLoads = Math.max(0, activeTileLoads - 1);
    }

    flushTileQueue();
  };

  return {
    cancel: finish,
    complete: finish,
    setPriority: (nextPriority: number) => {
      task.priority = nextPriority;
      flushTileQueue();
    }
  };
}

function publishBufferedTileStatus(
  managedLayer: ManagedLayer,
  layerId: ForestLayerId,
  onTileStatus?: (layerId: ForestLayerId, status: TileStatus) => void
) {
  if (!onTileStatus) {
    return;
  }

  while (managedLayer.reportedLoadedTiles < managedLayer.loadedTiles) {
    onTileStatus(layerId, "loaded");
    managedLayer.reportedLoadedTiles += 1;
  }

  while (managedLayer.reportedErrorTiles < managedLayer.errorTiles) {
    onTileStatus(layerId, "error");
    managedLayer.reportedErrorTiles += 1;
  }
}

function setTileLoadPriority(managedLayer: ManagedLayer, priority: number) {
  managedLayer.tileLoads.forEach((tileLoad) => tileLoad.setPriority(priority));
}

export function EarthEngineTileLayer({
  date,
  layerId,
  opacity,
  preloadMaxDate,
  preloadMinDate,
  zIndex,
  onTileStatus
}: EarthEngineTileLayerProps) {
  const map = useMap();
  const activeLayerRef = useRef<ManagedLayer | null>(null);
  const preloadLayersRef = useRef<Map<string, ManagedLayer>>(new Map());
  const transitionTokenRef = useRef(0);
  const removalTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const preloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const createManagedLayer = useCallback(
    ({
      initialOpacity,
      reportTileStatus,
      targetDate
    }: {
      initialOpacity: number;
      reportTileStatus: boolean;
      targetDate: string;
    }): ManagedLayer => {
      let managedLayer: ManagedLayer;

      const RuntimeGridLayer = L.GridLayer.extend({
        createTile(coords: Coords, done: DoneCallback) {
          const tile = L.DomUtil.create("img", "leaflet-tile") as HTMLImageElement;
          const tileSize = this.getTileSize();

          tile.alt = "";
          tile.width = tileSize.x;
          tile.height = tileSize.y;
          tile.decoding = "async";
          tile.referrerPolicy = "no-referrer";

          const tileUrl = buildTileUrl({
            coords,
            date: targetDate,
            layerId,
          });
          const tileQueueKey = buildTileQueueKey(layerId, targetDate);
          let retryAttempt = 0;
          let tileSettled = false;
          let queuedTileLoad: TileLoadTicket | undefined;
          const finishTile = () => {
            if (tileSettled) {
              return;
            }

            tileSettled = true;
            queuedTileLoad?.complete();
            if (queuedTileLoad) {
              managedLayer.tileLoads.delete(queuedTileLoad);
            }
          };
          const loadTile = () => {
            const retryUrl = new URL(tileUrl, window.location.href);
            if (retryAttempt > 0) {
              retryUrl.searchParams.set("retry", String(retryAttempt));
            }
            tile.src = `${retryUrl.pathname}${retryUrl.search}`;
          };

          tile.onload = () => {
            finishTile();
            managedLayer.loadedTiles += 1;
            if (managedLayer.reportTileStatus) {
              managedLayer.reportedLoadedTiles += 1;
              onTileStatus?.(layerId, "loaded");
            }
            done(undefined, tile);
          };
          tile.onerror = () => {
            const retryDelay = TILE_RETRY_DELAYS_MS[retryAttempt];
            if (retryDelay !== undefined) {
              retryAttempt += 1;
              setTimeout(loadTile, retryDelay);
              return;
            }

            tile.style.visibility = "hidden";
            finishTile();
            managedLayer.errorTiles += 1;
            if (managedLayer.reportTileStatus) {
              managedLayer.reportedErrorTiles += 1;
              onTileStatus?.(layerId, "error");
            }
            done(undefined, tile);
          };

          if (managedLayer.reportTileStatus) {
            loadTile();
          } else {
            queuedTileLoad = enqueueTileLoad(
              tileQueueKey,
              loadTile,
              TILE_QUEUE_PRIORITY_PRELOAD
            );
            managedLayer.tileLoads.add(queuedTileLoad);
          }

          return tile;
        }
      }) as typeof L.GridLayer;

      const layerOptions: GridLayerOptions = {
        opacity: initialOpacity,
        zIndex,
        tileSize: 256,
        updateInterval: 200,
        updateWhenIdle: false,
        updateWhenZooming: true,
        keepBuffer: 1
      };
      const layer = new RuntimeGridLayer(layerOptions);
      managedLayer = {
        layer,
        disposed: false,
        loaded: false,
        reportTileStatus,
        loadedTiles: 0,
        errorTiles: 0,
        reportedLoadedTiles: 0,
        reportedErrorTiles: 0,
        tileLoads: new Set(),
        date: targetDate
      };

      layer.on("add", () => {
        managedLayer.disposed = false;
        applyLayerTransition(layer);
      });
      layer.on("load", () => {
        managedLayer.loaded = true;
      });
      layer.on("remove", () => {
        managedLayer.disposed = true;
        managedLayer.tileLoads.forEach((tileLoad) => tileLoad.cancel());
        managedLayer.tileLoads.clear();
      });

      return managedLayer;
    },
    [layerId, map, onTileStatus, zIndex]
  );

  const clearPreloadLayers = useCallback(() => {
    preloadLayersRef.current.forEach((managedLayer) => managedLayer.layer.removeFrom(map));
    preloadLayersRef.current.clear();

    if (preloadTimerRef.current) {
      clearTimeout(preloadTimerRef.current);
      preloadTimerRef.current = null;
    }
  }, [map]);

  useEffect(() => {
    return () => {
      activeLayerRef.current?.layer.removeFrom(map);
      preloadLayersRef.current.forEach((managedLayer) => managedLayer.layer.removeFrom(map));
      removalTimersRef.current.forEach((timer) => clearTimeout(timer));
      if (preloadTimerRef.current) {
        clearTimeout(preloadTimerRef.current);
      }
    };
  }, [map]);

  useEffect(() => {
    map.on("movestart", clearPreloadLayers);
    map.on("zoomstart", clearPreloadLayers);

    return () => {
      map.off("movestart", clearPreloadLayers);
      map.off("zoomstart", clearPreloadLayers);
    };
  }, [clearPreloadLayers, map]);

  const preloadAdjacentDates = useCallback(
    (activeDate: string) => {
      if (map.getZoom() > PRELOAD_MAX_ZOOM) {
        clearPreloadLayers();
        return;
      }

      const adjacentDates = [addDays(activeDate, -1), addDays(activeDate, 1)].filter(
        (candidateDate) =>
          candidateDate >= DYNAMIC_WORLD_MIN_DATE &&
          (!preloadMinDate || candidateDate >= preloadMinDate) &&
          (!preloadMaxDate || candidateDate <= preloadMaxDate)
      );
      const wantedDates = new Set(adjacentDates);

      adjacentDates.forEach((adjacentDate) => {
        if (
          activeLayerRef.current?.date === adjacentDate ||
          preloadLayersRef.current.has(adjacentDate)
        ) {
          return;
        }

        const preloadLayer = createManagedLayer({
          initialOpacity: 0,
          reportTileStatus: false,
          targetDate: adjacentDate
        });
        preloadLayer.layer.addTo(map);
        preloadLayer.layer.setZIndex(zIndex - 1);
        preloadLayer.layer.setOpacity(0);
        preloadLayersRef.current.set(adjacentDate, preloadLayer);
      });

      preloadLayersRef.current.forEach((managedLayer, preloadDate) => {
        if (!wantedDates.has(preloadDate)) {
          managedLayer.layer.removeFrom(map);
          preloadLayersRef.current.delete(preloadDate);
        }
      });
    },
    [clearPreloadLayers, createManagedLayer, map, preloadMaxDate, preloadMinDate, zIndex]
  );

  useEffect(() => {
    const transitionToken = transitionTokenRef.current + 1;
    transitionTokenRef.current = transitionToken;
    if (preloadTimerRef.current) {
      clearTimeout(preloadTimerRef.current);
      preloadTimerRef.current = null;
    }

    const previousLayer = activeLayerRef.current;
    const preloadedLayer = preloadLayersRef.current.get(date);

    preloadLayersRef.current.forEach((managedLayer, preloadDate) => {
      if (preloadDate !== date) {
        managedLayer.layer.removeFrom(map);
        preloadLayersRef.current.delete(preloadDate);
      }
    });

    const nextLayer =
      preloadedLayer ??
      createManagedLayer({
        initialOpacity: previousLayer ? 0 : opacity,
        reportTileStatus: true,
        targetDate: date
      });

    preloadLayersRef.current.delete(date);

    if (previousLayer && previousLayer.layer !== nextLayer.layer) {
      previousLayer.reportTileStatus = false;
    }
    nextLayer.reportTileStatus = true;
    setTileLoadPriority(nextLayer, TILE_QUEUE_PRIORITY_ACTIVE);
    publishBufferedTileStatus(nextLayer, layerId, onTileStatus);
    activeLayerRef.current = nextLayer;

    if (!map.hasLayer(nextLayer.layer)) {
      nextLayer.layer.addTo(map);
    }

    nextLayer.layer.setZIndex(zIndex);
    nextLayer.layer.setOpacity(previousLayer ? 0 : opacity);
    applyLayerTransition(nextLayer.layer);

    let transitionFallbackTimer: ReturnType<typeof setTimeout> | undefined;
    const finishTransition = () => {
      if (transitionTokenRef.current !== transitionToken) {
        return;
      }

      nextLayer.layer.off("load", beginTransition);
      if (transitionFallbackTimer) {
        clearTimeout(transitionFallbackTimer);
      }

      nextLayer.layer.setOpacity(opacity);

      if (previousLayer && previousLayer.layer !== nextLayer.layer) {
        applyLayerTransition(previousLayer.layer);
        previousLayer.layer.setOpacity(0);

        const removalTimer = setTimeout(() => {
          previousLayer.layer.removeFrom(map);
        }, FADE_DURATION_MS + 80);
        removalTimersRef.current.push(removalTimer);
      }
    };
    const beginTransition = () => {
      requestAnimationFrame(finishTransition);
    };

    if (!previousLayer || previousLayer.layer === nextLayer.layer || nextLayer.loaded) {
      beginTransition();
    } else {
      nextLayer.layer.once("load", beginTransition);
      transitionFallbackTimer = setTimeout(beginTransition, TRANSITION_FALLBACK_MS);
      removalTimersRef.current.push(transitionFallbackTimer);
    }

    let preloadFallbackTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleAdjacentPreloads = () => {
      if (transitionTokenRef.current !== transitionToken) {
        return;
      }

      nextLayer.layer.off("load", scheduleAdjacentPreloads);
      if (preloadFallbackTimer) {
        clearTimeout(preloadFallbackTimer);
      }
      if (preloadTimerRef.current) {
        clearTimeout(preloadTimerRef.current);
      }

      preloadTimerRef.current = setTimeout(() => {
        if (transitionTokenRef.current === transitionToken) {
          preloadAdjacentDates(date);
        }
        preloadTimerRef.current = null;
      }, PRELOAD_AFTER_ACTIVE_DELAY_MS);
    };

    if (nextLayer.loaded) {
      scheduleAdjacentPreloads();
    } else {
      nextLayer.layer.once("load", scheduleAdjacentPreloads);
      preloadFallbackTimer = setTimeout(scheduleAdjacentPreloads, PRELOAD_FALLBACK_MS);
      removalTimersRef.current.push(preloadFallbackTimer);
    }

    return () => {
      nextLayer.layer.off("load", beginTransition);
      nextLayer.layer.off("load", scheduleAdjacentPreloads);
      if (transitionFallbackTimer) {
        clearTimeout(transitionFallbackTimer);
      }
      if (preloadFallbackTimer) {
        clearTimeout(preloadFallbackTimer);
      }
    };
  }, [createManagedLayer, date, layerId, map, onTileStatus, opacity, preloadAdjacentDates, zIndex]);

  return null;
}
