// App shell: loads data on boot, renders error/loading states or the 3-pane layout.

import { useEffect } from 'react';
import { useStore } from './state';
import { Header } from './components/Header';
import { Panel } from './components/Panel';
import { MapView } from './components/MapView';
import { Results } from './components/Results';

export default function App() {
  const loading = useStore((s) => s.loading);
  const loadError = useStore((s) => s.loadError);

  useEffect(() => {
    void useStore.getState().loadAll();
  }, []);

  if (loadError) {
    return (
      <div className="boot-panel boot-error" role="alert">
        <h1>Data files missing</h1>
        <p>{loadError}</p>
        <p>
          Expected files: <code>data/metrics.json</code>, <code>data/cbsas.json</code>,{' '}
          <code>data/boundaries.geojson</code> next to the app.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="boot-panel">Loading data…</div>;
  }

  return (
    <div className="app">
      <Header />
      <div className="main">
        <Panel />
        <MapView />
        <Results />
      </div>
    </div>
  );
}
