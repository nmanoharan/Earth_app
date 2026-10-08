"use client";

import { useEffect } from "react";
import L from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { type ForestLayerId } from "@forest/shared";
import { gramsToPounds, metricTonsToPounds } from "@/lib/impactCalculations";
import { type WorkLocationMarker } from "@/lib/workLocations";
import { EarthEngineTileLayer } from "./EarthEngineTileLayer";

export type MapTarget = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  zoom: number;
  type: "state" | "city";
};

type MapViewProps = {
  comparisonDate?: string;
  date: string;
  initialCenter?: [number, number];
  initialZoom?: number;
  workLocations?: WorkLocationMarker[];
  preloadMaxDate?: string;
  preloadMinDate?: string;
  visibleLayers: Record<ForestLayerId, boolean>;
  target?: MapTarget;
  onTileStatus?: (layerId: ForestLayerId, status: "loaded" | "error") => void;
  onWorkLocationSelect?: (marker: WorkLocationMarker) => void;
};

const WORK_CATEGORY_COLORS: Record<string, string> = {
  "native plants": "#7c3aed",
  trees: "#1f7a4a",
  "tree giveaway": "#d97706"
};

function colorForWorkCategory(category: string) {
  return WORK_CATEGORY_COLORS[category.toLowerCase()] ?? "#2563eb";
}

function markerRadius(marker: WorkLocationMarker) {
  const plantings = marker.plantings ?? marker.plantingLocations ?? 1;
  return Math.min(20, Math.max(6, Math.sqrt(plantings) * 0.75));
}

function formatMarkerNumber(value: number | null, suffix = "", maximumFractionDigits = 1) {
  if (value === null) {
    return "Not listed";
  }

  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value)}${suffix}`;
}

function formatMarkerCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "Not listed";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(value);
}

function keepPopupVisibleAfterMapMove(popup: L.Popup) {
  if (typeof window === "undefined") {
    return;
  }

  [120, 980].forEach((delay) => {
    window.setTimeout(() => {
      popup.update();
    }, delay);
  });
}

function FlyToTarget({ target }: { target?: MapTarget }) {
  const map = useMap();

  useEffect(() => {
    if (!target) {
      return;
    }

    map.flyTo([target.lat, target.lng], target.zoom, {
      duration: 0.9
    });
  }, [map, target]);

  return null;
}

function fitMapToWorkLocations(
  map: L.Map,
  markers: WorkLocationMarker[],
  initialCenter: [number, number],
  initialZoom: number,
  mode: "all" | "core" = "all"
) {
  const allValidMarkers = markers.filter(
    (marker) => Number.isFinite(marker.lat) && Number.isFinite(marker.lng)
  );
  const validMarkers = mode === "core" ? coreWorkLocationMarkers(allValidMarkers) : allValidMarkers;

  if (validMarkers.length === 0) {
    map.flyTo(initialCenter, initialZoom, {
      duration: 0.7
    });
    return;
  }

  if (validMarkers.length === 1) {
    map.flyTo([validMarkers[0].lat, validMarkers[0].lng], Math.max(initialZoom, 12), {
      duration: 0.7
    });
    return;
  }

  const bounds = L.latLngBounds(
    validMarkers.map((marker) => [marker.lat, marker.lng] as [number, number])
  );

  map.fitBounds(bounds.pad(0.04), {
    animate: true,
    maxZoom: 13,
    padding: [14, 14]
  });
}

function median(values: number[]) {
  const sortedValues = [...values].sort((firstValue, secondValue) => firstValue - secondValue);
  const middle = Math.floor(sortedValues.length / 2);

  return sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
    : sortedValues[middle];
}

function coreWorkLocationMarkers(markers: WorkLocationMarker[]) {
  if (markers.length <= 12) {
    return markers;
  }

  const center = {
    lat: median(markers.map((marker) => marker.lat)),
    lng: median(markers.map((marker) => marker.lng))
  };
  const latitudeRadians = (center.lat * Math.PI) / 180;
  const minimumCoreCount = Math.min(markers.length, Math.max(16, Math.ceil(markers.length * 0.32)));

  return [...markers]
    .sort((firstMarker, secondMarker) => {
      const firstDistance = Math.hypot(
        firstMarker.lat - center.lat,
        (firstMarker.lng - center.lng) * Math.cos(latitudeRadians)
      );
      const secondDistance = Math.hypot(
        secondMarker.lat - center.lat,
        (secondMarker.lng - center.lng) * Math.cos(latitudeRadians)
      );

      return firstDistance - secondDistance;
    })
    .slice(0, minimumCoreCount);
}

function WorkLocationInitialFit({
  initialCenter,
  initialZoom,
  markers
}: {
  initialCenter: [number, number];
  initialZoom: number;
  markers: WorkLocationMarker[];
}) {
  const map = useMap();

  useEffect(() => {
    if (markers.length === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      fitMapToWorkLocations(map, markers, initialCenter, initialZoom, "core");
    }, 80);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [initialCenter, initialZoom, map, markers]);

  return null;
}

function MapHomeControl({
  initialCenter,
  initialZoom,
  markers
}: {
  initialCenter: [number, number];
  initialZoom: number;
  markers: WorkLocationMarker[];
}) {
  const map = useMap();

  useEffect(() => {
    const homeControl = new L.Control({ position: "bottomright" });

    homeControl.onAdd = () => {
      const container = L.DomUtil.create("div", "leaflet-bar mapHomeControl");
      const button = L.DomUtil.create("button", "mapHomeButton", container);

      button.type = "button";
      button.title = "Show all OEOC locations";
      button.setAttribute("aria-label", "Show all OEOC locations");
      button.innerHTML =
        '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>';

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      L.DomEvent.on(button, "click", (event) => {
        L.DomEvent.preventDefault(event);
        fitMapToWorkLocations(map, markers, initialCenter, initialZoom);
      });

      return container;
    };

    homeControl.addTo(map);

    return () => {
      homeControl.remove();
    };
  }, [initialCenter, initialZoom, map, markers]);

  return null;
}

function MapBackgroundHomeReset({
  initialCenter,
  initialZoom,
  markers
}: {
  initialCenter: [number, number];
  initialZoom: number;
  markers: WorkLocationMarker[];
}) {
  const map = useMapEvents({
    click: () => {
      fitMapToWorkLocations(map, markers, initialCenter, initialZoom);
    }
  });

  return null;
}

function MapResizeObserver() {
  const map = useMap();

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const container = map.getContainer();
    let animationFrame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
      }

      animationFrame = requestAnimationFrame(() => {
        map.invalidateSize({
          animate: false
        });
        animationFrame = null;
      });
    });

    observer.observe(container);

    return () => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
      }
      observer.disconnect();
    };
  }, [map]);

  return null;
}

function WorkLocationMarkers({
  markers,
  onSelect
}: {
  markers: WorkLocationMarker[];
  onSelect?: (marker: WorkLocationMarker) => void;
}) {
  return (
    <>
      {markers.map((marker) => {
        const color = colorForWorkCategory(marker.category);

        return (
          <CircleMarker
            bubblingMouseEvents={false}
            center={[marker.lat, marker.lng]}
            eventHandlers={{
              click: () => onSelect?.(marker)
            }}
            key={marker.id}
            pathOptions={{
              color: "#ffffff",
              fillColor: color,
              fillOpacity: 0.82,
              opacity: 0.94,
              weight: 1.4
            }}
            radius={markerRadius(marker)}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {marker.eventName || marker.location}
            </Tooltip>
            <Popup
              autoPan
              autoPanPaddingBottomRight={[28, 52]}
              autoPanPaddingTopLeft={[28, 108]}
              className="workLocationPopup"
              keepInView
              maxHeight={360}
              maxWidth={320}
              minWidth={240}
              eventHandlers={{
                add: (event) => keepPopupVisibleAfterMapMove(event.target as L.Popup)
              }}
            >
              <div className="markerPopup">
                <h3>{marker.eventName || "OEOC work location"}</h3>
                <p>{marker.location}</p>
                <dl>
                  <div>
                    <dt>Date</dt>
                    <dd>{marker.date || marker.year || "Not listed"}</dd>
                  </div>
                  <div>
                    <dt>Category</dt>
                    <dd>{marker.category}</dd>
                  </div>
                  <div>
                    <dt>Plantings</dt>
                    <dd>{formatMarkerNumber(marker.plantings)}</dd>
                  </div>
                  <div>
                    <dt>Tree canopy</dt>
                    <dd>{formatMarkerNumber(marker.treeCanopy, " sq ft")}</dd>
                  </div>
                  <div>
                    <dt>CO2 removed</dt>
                    <dd>{formatMarkerNumber(metricTonsToPounds(marker.co2Saved), " lbs", 0)}</dd>
                  </div>
                  <div>
                    <dt>Runoff avoided</dt>
                    <dd>{formatMarkerNumber(marker.rainRunoff, " gallons", 0)}</dd>
                  </div>
                  <div>
                    <dt>Storm Water Management $</dt>
                    <dd>{formatMarkerCurrency(marker.stormwaterCostAvoided)}</dd>
                  </div>
                  <div>
                    <dt>Air pollutants removed</dt>
                    <dd>
                      {formatMarkerNumber(
                        gramsToPounds(marker.airPollutants),
                        " lbs",
                        1
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Air Pollutant Removal $</dt>
                    <dd>{formatMarkerCurrency(marker.airPollutantValueAvoided)}</dd>
                  </div>
                  <div>
                    <dt>Road Resurfacing $</dt>
                    <dd>{formatMarkerCurrency(marker.roadResurfacingCostAvoided)}</dd>
                  </div>
                  <div>
                    <dt>Energy Saving $</dt>
                    <dd>{formatMarkerCurrency(marker.energyCostSaved)}</dd>
                  </div>
                </dl>
                {marker.impactEstimateDate && (
                  <p className="markerEstimate">
                    EPA/i-Tree monthly estimate through {marker.impactEstimateDate}
                    {marker.impactAgeMonths !== undefined
                      ? ` (${Math.floor(marker.impactAgeMonths)} months since planting)`
                      : ""}
                  </p>
                )}
                {marker.partners && <p className="markerPartners">{marker.partners}</p>}
                {marker.estimated && (
                  <p className="markerEstimate">Approximate city-level location</p>
                )}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

export function MapView({
  comparisonDate,
  date,
  initialCenter = [39.5, -98.35],
  initialZoom = 4,
  workLocations = [],
  preloadMaxDate,
  preloadMinDate,
  visibleLayers,
  target,
  onTileStatus,
  onWorkLocationSelect
}: MapViewProps) {
  return (
    <MapContainer
      center={initialCenter}
      zoom={initialZoom}
      minZoom={3}
      maxZoom={14}
      zoomControl={false}
      className="mapCanvas"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ZoomControl position="bottomright" />
      <MapHomeControl initialCenter={initialCenter} initialZoom={initialZoom} markers={workLocations} />
      <MapBackgroundHomeReset
        initialCenter={initialCenter}
        initialZoom={initialZoom}
        markers={workLocations}
      />
      <WorkLocationInitialFit
        initialCenter={initialCenter}
        initialZoom={initialZoom}
        markers={workLocations}
      />
      <MapResizeObserver />
      <FlyToTarget target={target} />

      {visibleLayers.landCover && (
        <EarthEngineTileLayer
          layerId="landCover"
          date={date}
          opacity={0.88}
          preloadMaxDate={preloadMaxDate}
          preloadMinDate={preloadMinDate}
          zIndex={420}
          onTileStatus={onTileStatus}
        />
      )}

      {visibleLayers.treeCover && (
        <EarthEngineTileLayer
          layerId="treeCover"
          date={date}
          opacity={0.82}
          preloadMaxDate={preloadMaxDate}
          preloadMinDate={preloadMinDate}
          zIndex={430}
          onTileStatus={onTileStatus}
        />
      )}

      {visibleLayers.forestLoss && (
        <EarthEngineTileLayer
          layerId="forestLoss"
          comparisonDate={comparisonDate}
          date={date}
          opacity={0.82}
          preloadMaxDate={preloadMaxDate}
          preloadMinDate={preloadMinDate}
          zIndex={440}
          onTileStatus={onTileStatus}
        />
      )}

      <WorkLocationMarkers markers={workLocations} onSelect={onWorkLocationSelect} />
    </MapContainer>
  );
}
