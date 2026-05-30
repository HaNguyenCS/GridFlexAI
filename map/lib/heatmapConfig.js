import { DATASET_ID } from './sampleData';

// Three perceptually distinct color ramps mapped to the three score channels.
// Built using the kepler colorRange shape: { name, type, category, colors }.
const RAMP_RISK = {
  name: 'Operator Risk',
  type: 'sequential',
  category: 'Custom',
  colors: ['#240010', '#5b0024', '#a30033', '#e0144c', '#ff2e63', '#ffb3c0']
};
const RAMP_PRICE = {
  name: 'Capital Price',
  type: 'sequential',
  category: 'Custom',
  colors: ['#1c1503', '#3a2b04', '#7a5d10', '#c79321', '#f5d23a', '#ffeea1']
};
const RAMP_TRAFFIC = {
  name: 'Flow Traffic',
  type: 'sequential',
  category: 'Custom',
  colors: ['#021c1a', '#013b39', '#016860', '#019e8f', '#00d9c0', '#9bf6e9']
};

export const SCORES = [
  {
    id: 'risk',
    layerId: 'layer-risk',
    hexLayerId: 'hex-risk',
    label: 'RISK',
    sublabel: 'incident · safety',
    accent: '#ff2e63',
    soft: 'rgba(255,46,99,0.16)',
    ramp: RAMP_RISK,
    // Each channel uses progressively smaller hex coverage so when multiple
    // channels are active, the columns nest inside each other — visually
    // stacking as concentric tiers at the same XY location.
    coverage: 0.95,
    elevationScale: 22
  },
  {
    id: 'price',
    layerId: 'layer-price',
    hexLayerId: 'hex-price',
    label: 'PRICE',
    sublabel: 'capital · density',
    accent: '#f5d23a',
    soft: 'rgba(245,210,58,0.18)',
    ramp: RAMP_PRICE,
    coverage: 0.62,
    elevationScale: 26
  },
  {
    id: 'traffic',
    layerId: 'layer-traffic',
    hexLayerId: 'hex-traffic',
    label: 'TRAFFIC',
    sublabel: 'flow · throughput',
    accent: '#00d9c0',
    soft: 'rgba(0,217,192,0.18)',
    ramp: RAMP_TRAFFIC,
    coverage: 0.38,
    elevationScale: 30
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
            id: 'layer-risk',
            label: 'RISK',
            channel: 'risk',
            ramp: RAMP_RISK,
            isVisible: true
          }),
          buildHeatmapLayer({
            id: 'layer-price',
            label: 'PRICE',
            channel: 'price',
            ramp: RAMP_PRICE,
            isVisible: false
          }),
          buildHeatmapLayer({
            id: 'layer-traffic',
            label: 'TRAFFIC',
            channel: 'traffic',
            ramp: RAMP_TRAFFIC,
            isVisible: false
          }),
          // --- 3D elevated hexbin layers (rendered on top, nestable) -----
          buildHexLayer({
            id: 'hex-risk',
            label: 'RISK',
            channel: 'risk',
            ramp: RAMP_RISK,
            accentRGB: [255, 46, 99],
            isVisible: true,
            coverage: 0.95,
            elevationScale: 22
          }),
          buildHexLayer({
            id: 'hex-price',
            label: 'PRICE',
            channel: 'price',
            ramp: RAMP_PRICE,
            accentRGB: [245, 210, 58],
            isVisible: false,
            coverage: 0.62,
            elevationScale: 26
          }),
          buildHexLayer({
            id: 'hex-traffic',
            label: 'TRAFFIC',
            channel: 'traffic',
            ramp: RAMP_TRAFFIC,
            accentRGB: [0, 217, 192],
            isVisible: false,
            coverage: 0.38,
            elevationScale: 30
          })
        ],
        interactionConfig: {
          tooltip: {
            fieldsToShow: {
              [DATASET_ID]: [
                { name: 'region', format: null },
                { name: 'risk', format: null },
                { name: 'price', format: null },
                { name: 'traffic', format: null }
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
