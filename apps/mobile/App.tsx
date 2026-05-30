import { StatusBar } from "expo-status-bar";
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import MapView, { PROVIDER_DEFAULT, UrlTile, type Region } from "react-native-maps";
import { forestLayerConfigs, type ForestLayerId } from "@forest/shared";

type EarthEngineStatus = {
  configured: boolean;
  earliestAvailableDate?: string;
  latestAvailableDate?: string;
  message: string;
};
type SearchResult = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  zoom: number;
  type: "state" | "city";
};
type SearchStatus = "idle" | "loading" | "empty" | "error";

const DEFAULT_TILE_API_BASE_URL = "http://127.0.0.1:3001";
const TILE_API_BASE_URL =
  process.env.EXPO_PUBLIC_TILE_API_BASE_URL?.replace(/\/$/, "") ?? DEFAULT_TILE_API_BASE_URL;
const MIN_DYNAMIC_WORLD_DATE = "2015-07-15";
const MIN_MAP_ZOOM = 3;
const MAX_MAP_ZOOM = 14;
const initialLayers: Record<ForestLayerId, boolean> = {
  treeCover: true,
  forestLoss: false,
  landCover: true
};
const defaultRegion: Region = {
  latitude: 39.5,
  longitude: -98.35,
  latitudeDelta: 35,
  longitudeDelta: 35
};

function isDateValue(value?: string) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function parseDateValue(value: string) {
  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsedDate.getTime())
    ? new Date(`${MIN_DYNAMIC_WORLD_DATE}T00:00:00.000Z`)
    : parsedDate;
}

function formatDateValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = parseDateValue(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateValue(date);
}

function clampDate(value: string, minValue: string, maxValue: string) {
  if (value < minValue) {
    return minValue;
  }

  if (value > maxValue) {
    return maxValue;
  }

  return value;
}

function buildTileUrl(layerId: ForestLayerId, date: string) {
  const params = [
    `date=${encodeURIComponent(date)}`,
    `layerId=${encodeURIComponent(layerId)}`,
    "x={x}",
    "y={y}",
    "z={z}"
  ].join("&");

  return `${TILE_API_BASE_URL}/api/earth-engine/tiles?${params}`;
}

function regionForTarget(target: SearchResult): Region {
  const delta = Math.max(0.08, Math.min(35, 360 / 2 ** target.zoom));

  return {
    latitude: target.lat,
    longitude: target.lng,
    latitudeDelta: delta,
    longitudeDelta: delta
  };
}

function zoomFromRegion(region: Region) {
  const rawZoom = Math.log2(360 / Math.max(region.longitudeDelta, 0.0001));
  return Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, Math.round(rawZoom)));
}

export default function App() {
  const mapRef = useRef<ComponentRef<typeof MapView> | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [earliestDate, setEarliestDate] = useState(MIN_DYNAMIC_WORLD_DATE);
  const [latestDate, setLatestDate] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [status, setStatus] = useState<EarthEngineStatus>({
    configured: false,
    message: "Checking Google Earth Engine tiles."
  });
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [tileZoomLevel, setTileZoomLevel] = useState(zoomFromRegion(defaultRegion));
  const [visibleLayers, setVisibleLayers] =
    useState<Record<ForestLayerId, boolean>>(initialLayers);

  const activeCount = useMemo(
    () => Object.values(visibleLayers).filter(Boolean).length,
    [visibleLayers]
  );
  const canStepBack = Boolean(selectedDate && selectedDate > earliestDate);
  const canStepForward = Boolean(selectedDate && latestDate && selectedDate < latestDate);

  const updateDate = useCallback(
    (nextDate: string) => {
      if (!latestDate || !isDateValue(nextDate)) {
        return;
      }

      setSelectedDate(clampDate(nextDate, earliestDate, latestDate));
    },
    [earliestDate, latestDate]
  );
  const handleRegionChangeComplete = useCallback((region: Region) => {
    const nextZoomLevel = zoomFromRegion(region);
    setTileZoomLevel((currentZoomLevel) =>
      currentZoomLevel === nextZoomLevel ? currentZoomLevel : nextZoomLevel
    );
  }, []);
  const selectSearchResult = useCallback((result: SearchResult) => {
    setSearchStatus("idle");
    setSearchResults([]);
    setSearchQuery(result.label);
    Keyboard.dismiss();
    mapRef.current?.animateToRegion(regionForTarget(result), 900);
  }, []);
  const handleSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchStatus("empty");
      return;
    }

    setSearchStatus("loading");

    try {
      const response = await fetch(
        `${TILE_API_BASE_URL}/api/search?q=${encodeURIComponent(query)}`
      );
      if (!response.ok) {
        throw new Error(`Search request failed with ${response.status}.`);
      }

      const payload = (await response.json()) as { results?: SearchResult[] };
      const results = payload.results ?? [];
      setSearchResults(results);

      if (results.length === 0) {
        setSearchStatus("empty");
        return;
      }

      if (results.length === 1) {
        selectSearchResult(results[0]);
      } else {
        setSearchStatus("idle");
      }
    } catch {
      setSearchResults([]);
      setSearchStatus("error");
    }
  }, [searchQuery, selectSearchResult]);

  useEffect(() => {
    let ignore = false;

    async function loadStatus() {
      try {
        const response = await fetch(`${TILE_API_BASE_URL}/api/earth-engine/status`);
        if (!response.ok) {
          throw new Error(`Status request failed with ${response.status}.`);
        }

        const payload = (await response.json()) as EarthEngineStatus;
        if (ignore) {
          return;
        }

        const nextEarliestDate = isDateValue(payload.earliestAvailableDate)
          ? payload.earliestAvailableDate!
          : MIN_DYNAMIC_WORLD_DATE;
        const nextLatestDate = isDateValue(payload.latestAvailableDate)
          ? payload.latestAvailableDate!
          : "";

        setStatus(payload);
        setEarliestDate(nextEarliestDate);
        setLatestDate(nextLatestDate);
        setSelectedDate(nextLatestDate || nextEarliestDate);
      } catch (error) {
        if (!ignore) {
          setStatus({
            configured: false,
            message:
              error instanceof Error
                ? error.message
                : "Unable to load Google Earth Engine status."
          });
        }
      } finally {
        if (!ignore) {
          setLoadingStatus(false);
        }
      }
    }

    loadStatus();

    return () => {
      ignore = true;
    };
  }, []);

  const tileLayers = useMemo(
    () =>
      forestLayerConfigs
        .filter((layer) => visibleLayers[layer.id])
        .map((layer, index) => ({
          ...layer,
          opacity: layer.id === "landCover" ? 0.86 : 0.8,
          url: selectedDate ? buildTileUrl(layer.id, selectedDate) : "",
          zIndex: 20 + index
        })),
    [selectedDate, visibleLayers]
  );

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={defaultRegion}
        minZoomLevel={MIN_MAP_ZOOM}
        maxZoomLevel={MAX_MAP_ZOOM}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {tileLayers.map(
          (layer) =>
            layer.url && (
              <UrlTile
                key={`${layer.id}-${selectedDate}-z${tileZoomLevel}`}
                urlTemplate={layer.url}
                maximumNativeZ={MAX_MAP_ZOOM}
                maximumZ={MAX_MAP_ZOOM}
                minimumZ={MIN_MAP_ZOOM}
                opacity={layer.opacity}
                tileCacheMaxAge={60 * 10}
                tileSize={256}
                zIndex={layer.zIndex}
              />
            )
        )}
      </MapView>

      <View style={styles.overlay}>
        <Text style={styles.title}>US Dynamic World</Text>
        <Text style={styles.subtitle}>Earth Engine tiles · Layers active: {activeCount}</Text>

        <View style={styles.searchBlock}>
          <Text style={styles.searchLabel}>Search</Text>
          <View style={styles.searchForm}>
            <TextInput
              accessibilityLabel="Search city or state"
              autoCapitalize="words"
              clearButtonMode="while-editing"
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              placeholder="City or state"
              placeholderTextColor="#7f9188"
              returnKeyType="search"
              style={styles.searchInput}
              value={searchQuery}
            />
            <Pressable
              accessibilityLabel="Search map"
              disabled={searchStatus === "loading"}
              onPress={handleSearch}
              style={[styles.searchButton, searchStatus === "loading" && styles.disabledButton]}
            >
              <Text style={styles.searchButtonText}>
                {searchStatus === "loading" ? "..." : "Go"}
              </Text>
            </Pressable>
          </View>
          {searchStatus === "empty" ? (
            <Text style={styles.searchHint}>No matching city or state found.</Text>
          ) : null}
          {searchStatus === "error" ? (
            <Text style={styles.searchHint}>Search is unavailable.</Text>
          ) : null}
          {searchResults.length > 1 ? (
            <View style={styles.searchResults}>
              {searchResults.slice(0, 3).map((result) => (
                <Pressable
                  key={result.id}
                  onPress={() => selectSearchResult(result)}
                  style={styles.searchResult}
                >
                  <Text style={styles.searchResultText}>{result.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.statusBox}>
          {loadingStatus ? <ActivityIndicator color="#dff2e6" /> : null}
          <Text style={styles.statusText}>{status.message}</Text>
        </View>

        <ScrollView style={styles.layers} contentContainerStyle={styles.layersContent}>
          {forestLayerConfigs.map((layer) => (
            <Pressable
              key={layer.id}
              style={styles.layerItem}
              onPress={() =>
                setVisibleLayers((prev) => ({
                  ...prev,
                  [layer.id]: !prev[layer.id]
                }))
              }
            >
              <View style={[styles.swatch, { backgroundColor: layer.color }]} />
              <View style={styles.layerText}>
                <Text style={styles.layerTitle}>{layer.label}</Text>
                <Text style={styles.layerDesc}>{layer.description}</Text>
              </View>
              <Text style={styles.toggle}>{visibleLayers[layer.id] ? "ON" : "OFF"}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.dateBlock}>
          <Text style={styles.dateLabel}>Date</Text>
          <View style={styles.stepper}>
            <Pressable
              accessibilityLabel="Previous Dynamic World day"
              disabled={!canStepBack}
              style={[styles.stepButton, !canStepBack && styles.disabledButton]}
              onPress={() => updateDate(addDays(selectedDate, -1))}
            >
              <Text style={styles.stepButtonText}>-</Text>
            </Pressable>
            <Text style={styles.dateValue}>{selectedDate || "Loading"}</Text>
            <Pressable
              accessibilityLabel="Next Dynamic World day"
              disabled={!canStepForward}
              style={[styles.stepButton, !canStepForward && styles.disabledButton]}
              onPress={() => updateDate(addDays(selectedDate, 1))}
            >
              <Text style={styles.stepButtonText}>+</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>
            Available {earliestDate} to {latestDate || "loading"}. Tile API: {TILE_API_BASE_URL}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0d1f1a"
  },
  overlay: {
    margin: 12,
    marginTop: 24,
    backgroundColor: "rgba(13,31,26,0.86)",
    borderColor: "#355244",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12
  },
  title: {
    color: "#f6f8f3",
    fontSize: 20,
    fontWeight: "700"
  },
  subtitle: {
    color: "#b9c9bf",
    marginTop: 4
  },
  searchBlock: {
    marginTop: 12
  },
  searchLabel: {
    color: "#f6f8f3",
    fontWeight: "700",
    marginBottom: 6
  },
  searchForm: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  searchInput: {
    backgroundColor: "#eef5ed",
    borderRadius: 6,
    color: "#14231c",
    flex: 1,
    fontSize: 16,
    minHeight: 42,
    paddingHorizontal: 10
  },
  searchButton: {
    alignItems: "center",
    backgroundColor: "#2f8f5b",
    borderRadius: 6,
    height: 42,
    justifyContent: "center",
    width: 56
  },
  searchButtonText: {
    color: "#f6f8f3",
    fontWeight: "800"
  },
  searchHint: {
    color: "#c8d6cd",
    fontSize: 12,
    marginTop: 6
  },
  searchResults: {
    borderColor: "#426554",
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 8,
    overflow: "hidden"
  },
  searchResult: {
    borderBottomColor: "#315346",
    borderBottomWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  searchResultText: {
    color: "#f6f8f3",
    fontWeight: "600"
  },
  statusBox: {
    alignItems: "center",
    borderColor: "#426554",
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    padding: 8
  },
  statusText: {
    color: "#dff2e6",
    flex: 1,
    fontSize: 12
  },
  layers: {
    maxHeight: 220,
    marginTop: 12
  },
  layersContent: {
    gap: 8
  },
  layerItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  swatch: {
    borderRadius: 2,
    height: 12,
    width: 12
  },
  layerText: {
    flex: 1
  },
  layerTitle: {
    color: "#f6f8f3",
    fontWeight: "600"
  },
  layerDesc: {
    color: "#b9c9bf",
    fontSize: 12
  },
  toggle: {
    color: "#9fd5bb",
    fontSize: 12,
    fontWeight: "700"
  },
  dateBlock: {
    marginTop: 12
  },
  dateLabel: {
    color: "#f6f8f3",
    fontWeight: "700",
    marginBottom: 6
  },
  stepper: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  stepButton: {
    alignItems: "center",
    backgroundColor: "#2f8f5b",
    borderRadius: 6,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  disabledButton: {
    backgroundColor: "#6d8175"
  },
  stepButtonText: {
    color: "#f6f8f3",
    fontSize: 24,
    fontWeight: "800"
  },
  dateValue: {
    backgroundColor: "#eef5ed",
    borderRadius: 6,
    color: "#14231c",
    flex: 1,
    fontSize: 18,
    fontWeight: "800",
    paddingHorizontal: 10,
    paddingVertical: 11,
    textAlign: "center"
  },
  hint: {
    color: "#c8d6cd",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8
  }
});
