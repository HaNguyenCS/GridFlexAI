import { DATASET_ID } from './sampleData';

// Three perceptually distinct color ramps mapped to the three telemetry
// channels of the live power-grid feed:
//   LOAD   - capacity utilization (cool → amber → red)
//   SURGE  - voltage spike severity (deep crimson → magenta → pink)
//   OUTAGE - blackout severity (electric blue → cyan → ice)
const RAMP_LOAD = {
  name: 'Grid Load',
  type: 'sequential',
  category: 'Custom',
  colors: ['#1c1503', '#3a2b04', '#7a5d10', '#c79321', '#fbbf24', '#ffeea1']
};
const RAMP_SURGE = {
  name: 'Voltage Surge',
  type: 'sequential',
  category: 'Custom',
  colors: ['#240010', '#5b0024', '#a30033', '#e0144c', '#ff2e63', '#ffb3c0']
};
const RAMP_OUTAGE = {
  name: 'Outage Severity',
  type: 'sequential',
  category: 'Custom',
  colors: ['#03101e', '#0a2a4a', '#0f4d8c', '#1a78c9', '#3aa0ff', '#bbe2ff']
};

export const SCORES = [
  {
    id: 'load',
    layerId: 'layer-load',
    hexLayerId: 'hex-load',
    label: 'LOAD',
    sublabel: 'capacity · MW',
    unit: '%',
    accent: '#fbbf24',
    soft: 'rgba(251,191,36,0.18)',
    accentRGB: [251, 191, 36],
    ramp: RAMP_LOAD,
    // Each channel uses progressively smaller hex coverage so when multiple
    // channels are active, the columns nest inside each other — visually
    // stacking as concentric tiers at the same XY location.
    coverage: 0.95,
    elevationScale: 22
  },
  {
    id: 'surge',
    layerId: 'layer-surge',
    hexLayerId: 'hex-surge',
    label: 'SURGE',
    sublabel: 'voltage · spike',
    unit: 'σ',
    accent: '#ff2e63',
    soft: 'rgba(255,46,99,0.18)',
    accentRGB: [255, 46, 99],
    ramp: RAMP_SURGE,
    coverage: 0.62,
    elevationScale: 32
  },
  {
    id: 'outage',
    layerId: 'layer-outage',
    hexLayerId: 'hex-outage',
    label: 'OUTAGE',
    sublabel: 'blackout · severity',
    unit: 'idx',
    accent: '#3aa0ff',
    soft: 'rgba(58,160,255,0.18)',
    accentRGB: [58, 160, 255],
    ramp: RAMP_OUTAGE,
    coverage: 0.38,
    elevationScale: 40
  }
];

function buildHeatmapLayer({ id, label, channel, ramp, isVisible }) {
  return {
    id,
    type: 'heatmap',
    config: {
      dataId: DATASET_ID,
      label: `${label} HEATMAP`,
      color: [255, 255, 255],
      columns: { lat: 'lat', lng: 'lng' },
      isVisible,
      visConfig: {
        // Crank opacity + tighten the kernel so the heatmap reads as a
        // distinct, high-contrast gradient under the elevated hex columns.
        opacity: 0.95,
        colorRange: ramp,
        radius: 38,
        intensity: 1.6,
        threshold: 0.04
      }
    },
    visualChannels: {
      weightField: { name: channel, type: 'integer' },
      weightScale: 'linear'
    }
  };
}

// 3D elevated hexbin layer that rides ON TOP of the heatmap.
// Per-channel `coverage` keeps hex footprints nested when multiple channels
// are visible simultaneously (stacked-column effect).
function buildHexLayer({
  id,
  label,
  channel,
  ramp,
  accentRGB,
  isVisible,
  coverage,
  elevationScale
}) {
  return {
    id,
    type: 'hexagon',
    config: {
      dataId: DATASET_ID,
      label: `${label} ELEVATED`,
      color: accentRGB,
      columns: { lat: 'lat', lng: 'lng' },
      isVisible,
      visConfig: {
        opacity: 0.78,
        worldUnitSize: 0.18,
        resolution: 8,
        colorRange: ramp,
        coverage,
        sizeRange: [0, 320],
        percentile: [0, 100],
        elevationPercentile: [0, 100],
        elevationScale,
        enableElevationZoomFactor: true,
        enable3d: true,
        colorAggregation: 'average',
        sizeAggregation: 'average'
      }
    },
    visualChannels: {
      colorField: { name: channel, type: 'integer' },
      colorScale: 'quantize',
      sizeField: { name: channel, type: 'integer' },
      sizeScale: 'linear'
    }
  };
}

export function buildKeplerConfig() {
  return {
    version: 'v1',
    config: {
      visState: {
        filters: [],
        layers: [
          // --- base 2D heatmap layers -------------------------------------
          buildHeatmapLayer({
            id: 'layer-load',
            label: 'LOAD',
            channel: 'load',
            ramp: RAMP_LOAD,
            isVisible: true
          }),
          buildHeatmapLayer({
            id: 'layer-surge',
            label: 'SURGE',
            channel: 'surge',
            ramp: RAMP_SURGE,
            isVisible: false
          }),
          buildHeatmapLayer({
            id: 'layer-outage',
            label: 'OUTAGE',
            channel: 'outage',
            ramp: RAMP_OUTAGE,
            isVisible: false
          }),
          // --- 3D elevated hexbin layers (rendered on top, nestable) -----
          buildHexLayer({
            id: 'hex-load',
            label: 'LOAD',
            channel: 'load',
            ramp: RAMP_LOAD,
            accentRGB: [251, 191, 36],
            isVisible: true,
            coverage: 0.95,
            elevationScale: 22
          }),
          buildHexLayer({
            id: 'hex-surge',
            label: 'SURGE',
            channel: 'surge',
            ramp: RAMP_SURGE,
            accentRGB: [255, 46, 99],
            isVisible: false,
            coverage: 0.62,
            elevationScale: 32
          }),
          buildHexLayer({
            id: 'hex-outage',
            label: 'OUTAGE',
            channel: 'outage',
            ramp: RAMP_OUTAGE,
            accentRGB: [58, 160, 255],
            isVisible: false,
            coverage: 0.38,
            elevationScale: 40
          })
        ],
        interactionConfig: {
          tooltip: {
            fieldsToShow: {
              [DATASET_ID]: [
                { name: 'code', format: null },
                { name: 'node', format: null },
                { name: 'load', format: null },
                { name: 'surge', format: null },
                { name: 'outage', format: null }
              ]
            },
            enabled: true
          },
          brush: { enabled: false },
          geocoder: { enabled: false },
          coordinate: { enabled: false }
        },
        layerBlending: 'additive'
      },
      mapState: {
        bearing: -18,
        latitude: 43.651,
        longitude: -79.385,
        pitch: 42,
        zoom: 13.4,
        dragRotate: true
      },
      mapStyle: {
        styleType: 'dark',
        topLayerGroups: {},
        visibleLayerGroups: {
          label: true,
          road: true,
          border: false,
          building: true,
          water: true,
          land: true,
          '3d building': true
        },
        threeDBuildingColor: [16, 18, 22]
      }
    }
  };
}
