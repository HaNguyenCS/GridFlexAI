import { createStore, combineReducers, applyMiddleware, compose } from 'redux';
import { taskMiddleware } from 'react-palm/tasks';
import keplerGlReducer from '@kepler.gl/reducers';

const customizedKeplerGlReducer = keplerGlReducer.initialState({
  uiState: {
    // Hide kepler's default side panel — we provide our own.
    activeSidePanel: null,
    currentModal: null,
    readOnly: true,
    mapControls: {
      visibleLayers: { show: false },
      mapLegend: { show: false, active: false },
      toggle3d: { show: true },
      splitMap: { show: false },
      mapDraw: { show: false },
      mapLocale: { show: false }
    }
  },
  mapState: {
    // Downtown Toronto — corner of Bay & King.
    latitude: 43.651,
    longitude: -79.385,
    zoom: 13.4,
    pitch: 42,
    bearing: -18,
    dragRotate: true
  }
});

const reducers = combineReducers({
  keplerGl: customizedKeplerGlReducer
});

export const makeStore = () => {
  const composeEnhancers =
    (typeof window !== 'undefined' &&
      window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__) ||
    compose;
  return createStore(
    reducers,
    {},
    composeEnhancers(applyMiddleware(taskMiddleware))
  );
};
