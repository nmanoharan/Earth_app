export type ForestLayerId = "treeCover" | "forestLoss" | "landCover";

export type LayerConfig = {
  id: ForestLayerId;
  label: string;
  color: string;
  visibleByDefault: boolean;
  description: string;
};

export const forestLayerConfigs: LayerConfig[] = [
  {
    id: "treeCover",
    label: "Tree cover",
    color: "#238443",
    visibleByDefault: true,
    description: "Dynamic World trees probability"
  },
  {
    id: "forestLoss",
    label: "Forest loss",
    color: "#d7301f",
    visibleByDefault: true,
    description: "Tree probability drop vs previous year"
  },
  {
    id: "landCover",
    label: "Land cover",
    color: "#397d49",
    visibleByDefault: false,
    description: "Dynamic World land-cover classes"
  }
];
