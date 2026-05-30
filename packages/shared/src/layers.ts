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
    label: "Dynamic World Tree Probability",
    color: "#238443",
    visibleByDefault: true,
    description: "Earth Engine 30-day Dynamic World trees probability mosaic"
  },
  {
    id: "forestLoss",
    label: "Tree Probability Drop vs Previous Year",
    color: "#d7301f",
    visibleByDefault: false,
    description: "Year-over-year drop between 30-day Dynamic World trees mosaics"
  },
  {
    id: "landCover",
    label: "Dynamic World Land Cover Classes",
    color: "#397d49",
    visibleByDefault: true,
    description: "Earth Engine 30-day Dynamic World land-cover label mosaic"
  }
];
