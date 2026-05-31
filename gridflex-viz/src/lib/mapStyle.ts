// Map style — MapLibre GL JS-compatible style descriptor.

export const DARK_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export const FALLBACK_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "bg",
      type: "background" as const,
      paint: { "background-color": "#0a0d12" },
    },
    {
      id: "osm",
      type: "raster" as const,
      source: "osm",
      paint: { "raster-opacity": 0.35, "raster-saturation": -1 },
    },
  ],
};
