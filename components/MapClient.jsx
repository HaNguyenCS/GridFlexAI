'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Provider, useDispatch, useSelector } from 'react-redux';
import KeplerGl from '@kepler.gl/components';
import { addDataToMap, layerConfigChange } from '@kepler.gl/actions';
import { processRowObject } from '@kepler.gl/processors';

const KEPLER_INSTANCE_ID = 'food-map';

import { makeStore } from '@/lib/store';
import { DATASET_ID } from '@/lib/sampleData';
import { GridSimulator, STREAM_INTERVAL_MS } from '@/lib/streaming';
import { buildKeplerConfig, SCORES } from '@/lib/heatmapConfig';
import SidePanel from '@/components/SidePanel';
import StatusBar from '@/components/StatusBar';

// ----------------------------------------------------------------------------
// KeplerInner — wires the live grid feed into kepler.gl. Receives a stable
// simulator reference, runs a setInterval tick, and pushes each fresh row
// snapshot into the dataset via addDataToMap({ keepExistingConfig: true }) —
// this preserves all layer configuration across data replacements.
// ----------------------------------------------------------------------------
function KeplerInner({
  width,
  height,
  activeChannels,
  simulator,
  onSnapshot
}) {
  const dispatch = useDispatch();
  const layers = useSelector(
    (state) => state?.keplerGl?.[KEPLER_INSTANCE_ID]?.visState?.layers || []
  );

  // Mount: seed the dataset + initial kepler config exactly once.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const rows = simulator.buildRows();
    dispatch(
      addDataToMap({
        datasets: [
          {
            info: { id: DATASET_ID, label: 'Grid Live Telemetry' },
            data: processRowObject(rows)
          }
        ],
        options: { centerMap: false, readOnly: true },
        config: buildKeplerConfig()
      })
    );
    onSnapshot(simulator.snapshot());
  }, [dispatch, simulator, onSnapshot]);

  // Real-time stream tick: advance the simulator, replace dataset rows in
  // place, and re-publish the snapshot so the side panel + status bar
  // re-render with the latest values + alerts.
  useEffect(() => {
    const id = setInterval(() => {
      const snap = simulator.step();
      const rows = simulator.buildRows();
      dispatch(
        addDataToMap({
          datasets: [
            {
              info: { id: DATASET_ID, label: 'Grid Live Telemetry' },
              data: processRowObject(rows)
            }
          ],
          // keepExistingConfig keeps every layer + visual mapping intact;
          // only the underlying rows are swapped.
          options: {
            centerMap: false,
            readOnly: true,
            keepExistingConfig: true
          }
        })
      );
      onSnapshot(snap);
    }, STREAM_INTERVAL_MS);

    return () => clearInterval(id);
  }, [dispatch, simulator, onSnapshot]);

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
      appName="GRID-OPS"
      version="v1"
    />
  );
}

export default function MapClient() {
  const store = useMemo(() => makeStore(), []);
  // Build the simulator once. Stable reference across renders so the
  // streaming interval keeps a single source of truth.
  const simulator = useMemo(() => new GridSimulator(), []);

  // Multi-channel state: a Set of channel ids currently visible, plus a
  // "primary" channel that drives the side-panel stats display.
  const [activeChannels, setActiveChannels] = useState(
    () => new Set(['load'])
  );
  const [primary, setPrimary] = useState('load');
  const [size, setSize] = useState({ w: 1280, h: 720 });
  const [snapshot, setSnapshot] = useState(() => simulator.snapshot());

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
          simulator={simulator}
          onSnapshot={setSnapshot}
        />
      </div>
      <SidePanel
        activeChannels={activeChannels}
        primary={primary}
        onToggle={toggleChannel}
        onSetPrimary={setPrimary}
        snapshot={snapshot}
      />
      <StatusBar
        activeChannels={activeChannels}
        primary={primary}
        snapshot={snapshot}
      />
    </Provider>
  );
}
