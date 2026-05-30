// Map style — MapLibre GL JS-compatible style descriptor.
//
// Per the user's request we use MapLibre GL (https://maplibre.org/maplibre-gl-js/docs/API/)
// instead of Mapbox. We host a free-tier vector style that does NOT
// require an API key. CARTO's basemap CDN exposes MapLibre-compatible
// style URLs that ship raster + vector tiles under attribution.
//
// If you want to swap in your own vector tiles (Protomaps, MapTiler,
// OpenFreeMap) just change `DARK_STYLE_URL` below — no other code edits
// are required.

export const DARK_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export const LIGHT_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

/**
 * Fully self-contained MapLibre style — used as a hard fallback so the
 * demo never shows a white screen if the CDN style is unreachable. It
 * uses OpenStreetMap raster tiles with a dark CSS filter applied via
 * deck.gl's clear color (we tint the canvas underneath).
 */
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
