export const treeCoverAreas = [
  {
    id: "pacific-nw",
    name: "Pacific Northwest",
    center: [45.8, -123.0] as [number, number],
    radiusMeters: 240000,
    intensity: 0.85
  },
  {
    id: "appalachia",
    name: "Appalachian Forests",
    center: [37.0, -82.8] as [number, number],
    radiusMeters: 190000,
    intensity: 0.73
  },
  {
    id: "upper-lakes",
    name: "Upper Great Lakes",
    center: [46.5, -89.7] as [number, number],
    radiusMeters: 170000,
    intensity: 0.67
  }
];

export const forestLossAreas = [
  {
    id: "south-east",
    name: "Southeast Change Zone",
    center: [33.5, -84.2] as [number, number],
    radiusMeters: 130000,
    severity: "medium"
  },
  {
    id: "rocky-west",
    name: "Rocky Fringe Loss",
    center: [40.7, -106.0] as [number, number],
    radiusMeters: 110000,
    severity: "high"
  }
];

export const landCoverRegions = [
  {
    id: "midwest",
    name: "Midwest Mixed Cover",
    points: [
      [43.4, -97.0],
      [43.7, -91.0],
      [39.5, -90.0],
      [38.8, -95.8]
    ] as [number, number][]
  },
  {
    id: "southwest",
    name: "Southwest Sparse Tree Cover",
    points: [
      [36.5, -113.0],
      [36.8, -108.2],
      [33.8, -107.8],
      [33.0, -112.3]
    ] as [number, number][]
  }
];
