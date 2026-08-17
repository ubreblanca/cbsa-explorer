// MapLibre map: CBSA polygons colored by the current measure via feature-state,
// hover tooltip, click-select, selected outline, color-by control, legend.
// A muted grey layer of screened-out CBSAs (lazy-loaded, toggleable) sits
// below the scored choropleth so "reviewed and cut" is distinguishable from
// "no CBSA exists there". Basemap style failure degrades to a blank background
// with polygons intact.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import maplibregl from 'maplibre-gl';
import type {
  ExpressionSpecification,
  MapLayerMouseEvent,
  StyleSpecification,
} from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { applyFilters, getMeasure, serializeColorBy, parseColorBy, useStore } from '../state';
import { dataUrl } from '../data';
import { formatComposite, VIRIDIS } from '../format';
import { Legend } from './Legend';
import type { CbsaRow, EngineOutput } from '../types';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const SOURCE_ID = 'cbsas';
const EXCLUDED_SOURCE_ID = 'cbsas-excluded';
const EXCLUDED_LAYERS = ['cbsa-excluded-fill', 'cbsa-excluded-outline'] as const;

const TIP_OFFSET = 12; // px between cursor and tooltip
const TIP_MARGIN = 4; // px minimum distance from the map container's edges

// Cursor-anchored tooltip clamped to the map container: measures itself after
// render, then flips left of / above the cursor when it would overflow the
// right/bottom edge (long exclusion reasons near the Gulf Coast, for example).
function MapTooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    let left = x + TIP_OFFSET;
    let top = y + TIP_OFFSET;
    if (left + el.offsetWidth > parent.clientWidth - TIP_MARGIN) {
      left = Math.max(TIP_MARGIN, x - TIP_OFFSET - el.offsetWidth);
    }
    if (top + el.offsetHeight > parent.clientHeight - TIP_MARGIN) {
      top = Math.max(TIP_MARGIN, y - TIP_OFFSET - el.offsetHeight);
    }
    // Bail out with the same reference when unchanged, or this every-render
    // effect would re-render forever.
    setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  });

  return (
    <div
      ref={ref}
      className="map-tooltip"
      role="tooltip"
      style={
        pos
          ? { left: pos.left, top: pos.top }
          : { left: x + TIP_OFFSET, top: y + TIP_OFFSET, visibility: 'hidden' } // measuring pass
      }
    >
      {children}
    </div>
  );
}

const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  name: 'blank-fallback',
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8ecef' } }],
};

async function resolveStyle(): Promise<StyleSpecification> {
  try {
    const res = await fetch(STYLE_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as StyleSpecification;
  } catch (err) {
    console.warn('Basemap style unavailable; using blank background.', err);
    return FALLBACK_STYLE;
  }
}

// t in [0,1] arrives via feature-state; negative t means "no data" grey.
const T_EXPR: ExpressionSpecification = ['coalesce', ['feature-state', 't'], -1];
const FILL_COLOR = [
  'case',
  ['<', T_EXPR, 0],
  'rgba(128,128,128,0.35)',
  ['interpolate', ['linear'], T_EXPR, ...VIRIDIS.flatMap(([t, c]) => [t, c])],
] as unknown as ExpressionSpecification;
const HIDDEN_EXPR: ExpressionSpecification = [
  'boolean',
  ['feature-state', 'hidden'],
  false,
];
const FILL_OPACITY = ['case', HIDDEN_EXPR, 0.04, 0.68] as unknown as ExpressionSpecification;
const LINE_OPACITY = ['case', HIDDEN_EXPR, 0.05, 0.55] as unknown as ExpressionSpecification;

type HoverInfo =
  | { kind: 'scored'; id: string; x: number; y: number }
  | { kind: 'excluded'; name: string; reason: string; x: number; y: number };

export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [layersReady, setLayersReady] = useState(false);
  const [excludedReady, setExcludedReady] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const registry = useStore((s) => s.registry);
  const rows = useStore((s) => s.rows);
  const boundaries = useStore((s) => s.boundaries);
  const engine = useStore((s) => s.engine);
  const colorBy = useStore((s) => s.colorBy);
  const filters = useStore((s) => s.filters);
  const selectedId = useStore((s) => s.selectedId);
  const flyNonce = useStore((s) => s.flyNonce);
  const showExcluded = useStore((s) => s.showExcluded);

  // Latest row/score lookup for event handlers bound once.
  const latestRef = useRef<{ rowById: Map<string, CbsaRow>; engine: EngineOutput | null }>({
    rowById: new Map(),
    engine: null,
  });
  latestRef.current = { rowById: new Map(rows.map((r) => [r.id, r])), engine };

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let map: maplibregl.Map | null = null;
    void resolveStyle().then((style) => {
      if (cancelled) return;
      map = new maplibregl.Map({
        container,
        style,
        center: [-98.5, 39.5],
        zoom: 3.7,
        attributionControl: false,
      });
      map.addControl(
        new maplibregl.AttributionControl({
          compact: true,
          customAttribution:
            '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
        }),
      );
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.on('load', () => {
        if (!cancelled) setStyleReady(true);
      });
      map.on('error', (e) => {
        // Tile/style resource errors are non-fatal; keep polygons rendering.
        console.warn('Map resource error (non-fatal):', e.error?.message ?? e);
      });
      mapRef.current = map;
      // Intentionally exposed in production builds too: integration tests run
      // against `vite preview` (a prod build), and it doubles as a console
      // debug handle. Nothing sensitive is reachable from it.
      (window as Window & { __citiesMap?: maplibregl.Map }).__citiesMap = map;
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      map = null;
    };
  }, []);

  // Add the polygon source + layers once style and data are ready.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || !boundaries) return;
    if (map.getSource(SOURCE_ID)) return;

    map.addSource(SOURCE_ID, { type: 'geojson', data: boundaries, promoteId: 'id' });

    // Slot polygons under basemap labels when a real basemap loaded.
    const firstSymbolId = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;

    map.addLayer(
      {
        id: 'cbsa-fill',
        type: 'fill',
        source: SOURCE_ID,
        paint: { 'fill-color': FILL_COLOR, 'fill-opacity': FILL_OPACITY },
      },
      firstSymbolId,
    );
    map.addLayer(
      {
        id: 'cbsa-outline',
        type: 'line',
        source: SOURCE_ID,
        paint: { 'line-color': '#4a5560', 'line-width': 0.6, 'line-opacity': LINE_OPACITY },
      },
      firstSymbolId,
    );
    map.addLayer({
      id: 'cbsa-selected',
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['get', 'id'], ''],
      paint: { 'line-color': '#0b1020', 'line-width': 2.5 },
    });

    const onMove = (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const id = String((feature.properties as Record<string, unknown>)['id'] ?? '');
      map.getCanvas().style.cursor = 'pointer';
      setHover({ kind: 'scored', id, x: e.point.x, y: e.point.y });
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = '';
      // Only clear our own tooltip: crossing directly onto an excluded polygon
      // can fire this leave AFTER the excluded layer's move.
      setHover((h) => (h && h.kind !== 'scored' ? h : null));
    };
    const onClick = (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const id = String((feature.properties as Record<string, unknown>)['id'] ?? '');
      if (latestRef.current.rowById.has(id)) useStore.getState().select(id);
    };
    map.on('mousemove', 'cbsa-fill', onMove);
    map.on('mouseleave', 'cbsa-fill', onLeave);
    map.on('click', 'cbsa-fill', onClick);

    setLayersReady(true);
  }, [styleReady, boundaries]);

  // Lazy-load the screened-out layer AFTER the scored choropleth is up.
  // Non-blocking: a missing file just logs a warning and skips the layer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady || excludedReady) return;
    if (map.getSource(EXCLUDED_SOURCE_ID)) return;
    let cancelled = false;

    void (async () => {
      let fc: FeatureCollection;
      try {
        const res = await fetch(dataUrl('data/boundaries_excluded.geojson'));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fc = (await res.json()) as FeatureCollection;
      } catch (err) {
        console.warn('boundaries_excluded.geojson unavailable (excluded layer disabled).', err);
        return;
      }
      if (cancelled || !mapRef.current || map.getSource(EXCLUDED_SOURCE_ID)) return;

      map.addSource(EXCLUDED_SOURCE_ID, { type: 'geojson', data: fc, promoteId: 'id' });
      const visibility = useStore.getState().showExcluded ? 'visible' : 'none';
      // Inserted before 'cbsa-fill', i.e. BELOW the scored fill + outlines.
      map.addLayer(
        {
          id: 'cbsa-excluded-fill',
          type: 'fill',
          source: EXCLUDED_SOURCE_ID,
          layout: { visibility },
          paint: { 'fill-color': '#9ea5ad', 'fill-opacity': 0.45 },
        },
        'cbsa-fill',
      );
      map.addLayer(
        {
          id: 'cbsa-excluded-outline',
          type: 'line',
          source: EXCLUDED_SOURCE_ID,
          layout: { visibility },
          paint: {
            'line-color': '#8f979f',
            'line-width': 0.5,
            'line-opacity': 0.45,
            'line-dasharray': [2, 2],
          },
        },
        'cbsa-fill',
      );

      const onMove = (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties as Record<string, unknown>;
        map.getCanvas().style.cursor = 'pointer';
        setHover({
          kind: 'excluded',
          name: String(props['name'] ?? ''),
          reason: String(props['reason'] ?? ''),
          x: e.point.x,
          y: e.point.y,
        });
      };
      const onLeave = () => {
        map.getCanvas().style.cursor = '';
        setHover((h) => (h && h.kind !== 'excluded' ? h : null));
      };
      // Excluded CBSAs have no scores: hover informs, click is a deliberate
      // no-op so the selection/results flow is never entered.
      map.on('mousemove', 'cbsa-excluded-fill', onMove);
      map.on('mouseleave', 'cbsa-excluded-fill', onLeave);

      useStore.getState().setExcludedCount(fc.features.length);
      setExcludedReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [layersReady, excludedReady]);

  // Excluded-layer visibility toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !excludedReady) return;
    const visibility = showExcluded ? 'visible' : 'none';
    for (const id of EXCLUDED_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    }
    if (!showExcluded) setHover((h) => (h && h.kind === 'excluded' ? null : h));
  }, [excludedReady, showExcluded]);

  // Push per-feature color state on every recompute / colorBy / filter change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady || !engine) return;
    const visible = new Set(applyFilters(rows, filters).map((r) => r.id));
    const measures = new Map<string, number | null>();
    for (const row of rows) measures.set(row.id, getMeasure(row, engine, colorBy));
    const vals: number[] = [];
    for (const id of visible) {
      const v = measures.get(id);
      if (v !== null && v !== undefined) vals.push(v);
    }
    const min = vals.length > 0 ? Math.min(...vals) : 0;
    const max = vals.length > 0 ? Math.max(...vals) : 1;
    const span = max - min || 1;
    for (const row of rows) {
      const v = measures.get(row.id);
      map.setFeatureState(
        { source: SOURCE_ID, id: row.id },
        {
          t: v === null || v === undefined ? -1 : Math.max(0, Math.min(1, (v - min) / span)),
          hidden: !visible.has(row.id),
        },
      );
    }
  }, [layersReady, engine, colorBy, filters, rows]);

  // Selected-feature bold outline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady) return;
    map.setFilter('cbsa-selected', ['==', ['get', 'id'], selectedId ?? '']);
  }, [layersReady, selectedId]);

  // flyTo when the selection came from the results list.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || flyNonce === 0) return;
    const { selectedId: id, rows: allRows } = useStore.getState();
    const row = allRows.find((r) => r.id === id);
    if (!row) return;
    map.flyTo({ center: [row.lon, row.lat], zoom: Math.max(map.getZoom(), 6), duration: 900 });
  }, [flyNonce]);

  const hoverRow =
    hover?.kind === 'scored' ? latestRef.current.rowById.get(hover.id) : undefined;
  const hoverScore = hoverRow && engine ? engine.byId.get(hoverRow.id) : undefined;
  const hoverRank = hoverRow && engine ? engine.rankById.get(hoverRow.id) : undefined;

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" role="application" aria-label="Map of CBSAs" />
      {registry && (
        <div className="map-colorby">
          <label>
            Color by{' '}
            <select
              value={serializeColorBy(colorBy)}
              onChange={(e) =>
                useStore.getState().setColorBy(parseColorBy(e.target.value, registry))
              }
              aria-label="Color map by"
            >
              <option value="composite">Composite score</option>
              <optgroup label="Group scores">
                {[...registry.groups]
                  .sort((a, b) => a.order - b.order)
                  .map((g) => (
                    <option key={g.id} value={`g:${g.id}`}>
                      {g.label}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Metric scores">
                {registry.metrics.map((m) => (
                  <option key={m.id} value={`m:${m.id}`}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        </div>
      )}
      <Legend />
      {hover?.kind === 'scored' && hoverRow && (
        <MapTooltip x={hover.x} y={hover.y}>
          <strong>{hoverRow.name}</strong>
          <span>
            composite {hoverScore ? formatComposite(hoverScore.composite) : '—'}
            {hoverRank !== undefined ? ` · rank #${hoverRank}` : ''}
          </span>
        </MapTooltip>
      )}
      {hover?.kind === 'excluded' && (
        <MapTooltip x={hover.x} y={hover.y}>
          <strong>{hover.name}</strong>
          <span className="map-tooltip-excluded">Screened out</span>
          <span className="map-tooltip-reason">{hover.reason}</span>
        </MapTooltip>
      )}
    </div>
  );
}
