"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, ZoomControl, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { type ForestLayerId } from "@forest/shared";
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
  date: string;
  preloadMaxDate?: string;
  preloadMinDate?: string;
  visibleLayers: Record<ForestLayerId, boolean>;
  target?: MapTarget;
  onTileStatus?: (layerId: ForestLayerId, status: "loaded" | "error") => void;
};

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

export function MapView({
  date,
  preloadMaxDate,
  preloadMinDate,
  visibleLayers,
  target,
  onTileStatus
}: MapViewProps) {
  return (
    <MapContainer
      center={[39.5, -98.35]}
      zoom={4}
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
          date={date}
          opacity={0.82}
          preloadMaxDate={preloadMaxDate}
          preloadMinDate={preloadMinDate}
          zIndex={440}
          onTileStatus={onTileStatus}
        />
      )}
    </MapContainer>
  );
}
