'use client';

import { useEffect, useMemo, useState } from 'react';
import { Provider, useDispatch, useSelector } from 'react-redux';
import KeplerGl from '@kepler.gl/components';
import { addDataToMap, layerConfigChange } from '@kepler.gl/actions';
import { processRowObject } from '@kepler.gl/processors';

const KEPLER_INSTANCE_ID = 'food-map';

import { makeStore } from '@/lib/store';
import { REGION_DATASET, DATASET_ID } from '@/lib/sampleData';
import { buildKeplerConfig, SCORES } from '@/lib/heatmapConfig';
import SidePanel from '@/components/SidePanel';
import StatusBar from '@/components/StatusBar';

function KeplerInner({ width, height, activeChannels }) {
  const dispatch = useDispatch();
  // Read the live layer instances out of kepler's visState — these are real
  // Layer objects that expose `updateLayerConfig`, which `layerConfigChange`
  // requires. Passing a plain `{ id }` stub triggers a runtime TypeError.
  const layers = useSelector(
    (state) => state?.keplerGl?.[KEPLER_INSTANCE_ID]?.visState?.layers || []
  );

  // Load dataset + config once on mount.
  useEffect(() => {
    const rows = REGION_DATASET.rows.map((r) => ({
      region: r[0],
      lat: r[1],
      lng: r[2],
      risk: r[3],
      price: r[4],
      traffic: r[5]
    }));
    const dataset = {
      info: { id: DATASET_ID, label: 'Regional Score Index' },
      data: processRowObject(rows)
    };

    dispatch(
      addDataToMap({
        datasets: [dataset],
        options: { centerMap: false, readOnly: true },
        config: buildKeplerConfig()
      })
    );
  }, [dispatch]);

  // Toggle BOTH the heatmap and the elevated hexbin layer per channel.
  // Multiple channels can be active simultaneously (stacked columns).
  useEffect(() => {
    if (!layers.length) return;
    const setVis = (id, shouldShow) => {
      const layer = layers.find((l) => l?.id === id);
      if (!layer) return;
      if (layer.config?.isVisible === shouldShow) return;
      dispatch(layerConfigChange(layer, { isVisible: shouldShow }));
    };
    SCORES.forEach((score) => {
      const shouldShow = activeChannels.has(score.id);
      setVis(score.layerId, shouldShow);
      setVis(score.hexLayerId, shouldShow);
    });
  }, [activeChannels, layers, dispatch]);

  return (
    <KeplerGl
      id={KEPLER_INSTANCE_ID}
      width={width}
      height={height}
      mapboxApiAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''}
      appName="FOOD-MAP"
      version="v1"
    />
  );
}

export default function MapClient() {
  const store = useMemo(() => makeStore(), []);
  // Multi-channel state: a Set of channel ids currently visible, plus a
  // "primary" channel that drives the side-panel stats display.
  const [activeChannels, setActiveChannels] = useState(
    () => new Set(['risk'])
  );
  const [primary, setPrimary] = useState('risk');
  const [size, setSize] = useState({ w: 1280, h: 720 });

  useEffect(() => {
    const handle = () =>
      setSize({ w: window.innerWidth, h: window.innerHeight });
    handle();
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  const toggleChannel = (id) => {
    setActiveChannels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Always keep at least one channel visible so the map isn't empty.
        if (next.size === 1) return prev;
        next.delete(id);
        if (primary === id) {
          const fallback = [...next][0];
          if (fallback) setPrimary(fallback);
        }
      } else {
        next.add(id);
        setPrimary(id);
      }
      return next;
    });
  };

  return (
    <Provider store={store}>
      <div className="map-stage">
        <KeplerInner
          width={size.w}
          height={size.h}
          activeChannels={activeChannels}
        />
      </div>
      <SidePanel
        activeChannels={activeChannels}
        primary={primary}
        onToggle={toggleChannel}
        onSetPrimary={setPrimary}
      />
      <StatusBar activeChannels={activeChannels} primary={primary} />
    </Provider>
  );
}
