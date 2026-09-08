// One national geometry source. Eligibility/reasons update with the user's screens.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl';
import { applyFilters, getMeasure, serializeColorBy, parseColorBy, useStore } from '../state';
import { formatComposite, VIRIDIS } from '../format';
import { Legend } from './Legend';

const SOURCE_ID = 'cbsas';
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const EXCLUDED_LAYERS = ['cbsa-excluded-fill', 'cbsa-excluded-outline'];

function MapTooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current, parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    let left = x + 12, top = y + 12;
    if (left + el.offsetWidth > parent.clientWidth - 4) left = Math.max(4, x - 12 - el.offsetWidth);
    if (top + el.offsetHeight > parent.clientHeight - 4) top = Math.max(4, y - 12 - el.offsetHeight);
    setPos((p) => p && p.left === left && p.top === top ? p : { left, top });
  });
  return <div ref={ref} className="map-tooltip" role="tooltip"
    style={pos ?? { left: x + 12, top: y + 12, visibility: 'hidden' }}>{children}</div>;
}

const FALLBACK_STYLE: StyleSpecification = {
  version: 8, name: 'blank-fallback', sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8ecef' } }],
};
async function resolveStyle(): Promise<StyleSpecification> {
  try {
    const res = await fetch(STYLE_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as StyleSpecification;
  } catch (err) {
    console.warn('Basemap unavailable; using blank background.', err);
    return FALLBACK_STYLE;
  }
}
const T_EXPR: ExpressionSpecification = ['coalesce', ['feature-state', 't'], -1];
const FILL_COLOR = ['case', ['<', T_EXPR, 0], '#b8bec4',
  ['interpolate', ['linear'], T_EXPR, ...VIRIDIS.flatMap(([t, c]) => [t, c])]] as ExpressionSpecification;
const HIDDEN: ExpressionSpecification = ['boolean', ['feature-state', 'hidden'], false];

type Hover = { id: string; x: number; y: number; layer: string };

export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [layersReady, setLayersReady] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const registry = useStore((s) => s.registry);
  const rows = useStore((s) => s.rows);
  const boundaries = useStore((s) => s.boundaries);
  const engine = useStore((s) => s.engine);
  const colorBy = useStore((s) => s.colorBy);
  const filters = useStore((s) => s.filters);
  const selectedId = useStore((s) => s.selectedId);
  const flyNonce = useStore((s) => s.flyNonce);
  const showExcluded = useStore((s) => s.showExcluded);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    void resolveStyle().then((style) => {
      if (cancelled) return;
      const map = new maplibregl.Map({ container, style, center: [-98.5, 39.5], zoom: 3.7, attributionControl: false });
      map.addControl(new maplibregl.AttributionControl({ compact: true,
        customAttribution: '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>' }));
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.on('load', () => { if (!cancelled) setStyleReady(true); });
      map.on('error', (e) => console.warn('Map resource error (non-fatal):', e.error?.message ?? e));
      mapRef.current = map;
      (window as Window & { __citiesMap?: maplibregl.Map }).__citiesMap = map;
    });
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || !boundaries || map.getSource(SOURCE_ID)) return;
    map.addSource(SOURCE_ID, { type: 'geojson', data: boundaries, promoteId: 'id' });
    const before = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
    const empty: ExpressionSpecification = ['in', ['get', 'id'], ['literal', []]];
    map.addLayer({ id: 'cbsa-excluded-fill', type: 'fill', source: SOURCE_ID, filter: empty,
      paint: { 'fill-color': '#9ea5ad', 'fill-opacity': 0.45 } }, before);
    map.addLayer({ id: 'cbsa-excluded-outline', type: 'line', source: SOURCE_ID, filter: empty,
      paint: { 'line-color': '#8f979f', 'line-width': 0.5, 'line-opacity': 0.45, 'line-dasharray': [2, 2] } }, before);
    map.addLayer({ id: 'cbsa-fill', type: 'fill', source: SOURCE_ID, filter: empty,
      paint: { 'fill-color': FILL_COLOR, 'fill-opacity': ['case', HIDDEN, 0.04, 0.68] } }, before);
    map.addLayer({ id: 'cbsa-outline', type: 'line', source: SOURCE_ID, filter: empty,
      paint: { 'line-color': '#4a5560', 'line-width': 0.6, 'line-opacity': ['case', HIDDEN, 0.05, 0.55] } }, before);
    map.addLayer({ id: 'cbsa-selected', type: 'line', source: SOURCE_ID,
      filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#0b1020', 'line-width': 2.5 } });
    for (const layer of ['cbsa-fill', 'cbsa-excluded-fill']) {
      const identify = (e: MapLayerMouseEvent) => String(e.features?.[0]?.properties?.['id'] ?? '');
      map.on('mousemove', layer, (e) => {
        const id = identify(e);
        if (!id) return;
        map.getCanvas().style.cursor = 'pointer';
        setHover({ id, x: e.point.x, y: e.point.y, layer });
      });
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = '';
        setHover((h) => h?.layer === layer ? null : h);
      });
      // Excluded areas can still be inspected; only their ranking is gated.
      map.on('click', layer, (e) => { const id = identify(e); if (id) useStore.getState().select(id); });
    }
    setLayersReady(true);
  }, [styleReady, boundaries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady || !engine) return;
    const include: ExpressionSpecification = ['in', ['get', 'id'], ['literal', [...engine.eligibleIds]]];
    for (const id of ['cbsa-fill', 'cbsa-outline']) map.setFilter(id, include);
    for (const id of EXCLUDED_LAYERS) {
      map.setFilter(id, ['!', include]);
      map.setLayoutProperty(id, 'visibility', showExcluded ? 'visible' : 'none');
    }
    // Old hover reasons must not linger after changing a threshold.
    setHover(null);
  }, [layersReady, engine, showExcluded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady || !engine) return;
    const visible = new Set(applyFilters(rows, filters).filter((r) => engine.eligibleIds.has(r.id)).map((r) => r.id));
    const measures = new Map(rows.map((r) => [r.id, getMeasure(r, engine, colorBy)]));
    const values = [...visible].map((id) => measures.get(id)).filter((v): v is number => v != null);
    const min = values.length ? Math.min(...values) : 0, max = values.length ? Math.max(...values) : 1;
    for (const row of rows) {
      const v = measures.get(row.id);
      map.setFeatureState({ source: SOURCE_ID, id: row.id }, {
        t: v == null ? -1 : Math.max(0, Math.min(1, (v - min) / (max - min || 1))), hidden: !visible.has(row.id),
      });
    }
  }, [layersReady, engine, colorBy, filters, rows]);

  useEffect(() => {
    if (layersReady) mapRef.current?.setFilter('cbsa-selected', ['==', ['get', 'id'], selectedId ?? '']);
  }, [layersReady, selectedId]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || flyNonce === 0) return;
    const s = useStore.getState(), row = s.rows.find((r) => r.id === s.selectedId);
    if (row) map.flyTo({ center: [row.lon, row.lat], zoom: Math.max(map.getZoom(), 6), duration: 900 });
  }, [flyNonce]);

  const hoverRow = hover ? rows.find((r) => r.id === hover.id) : undefined;
  const result = hoverRow ? engine?.byId.get(hoverRow.id) : undefined;
  const verdict = hoverRow ? engine?.eligibility.get(hoverRow.id) : undefined;
  const rank = hoverRow ? engine?.rankById.get(hoverRow.id) : undefined;
  return <div className="map-wrap">
    <div ref={containerRef} className="map" role="application" aria-label="Map of CBSAs" />
    {registry && <div className="map-colorby"><label>Color by{' '}
      <select value={serializeColorBy(colorBy)} aria-label="Color map by"
        onChange={(e) => useStore.getState().setColorBy(parseColorBy(e.target.value, registry))}>
        <option value="composite">Composite score</option>
        <optgroup label="Group scores">{[...registry.groups].sort((a, b) => a.order - b.order).map((g) => <option key={g.id} value={`g:${g.id}`}>{g.label}</option>)}</optgroup>
        <optgroup label="Metric scores">{registry.metrics.map((m) => <option key={m.id} value={`m:${m.id}`}>{m.label}</option>)}</optgroup>
      </select></label></div>}
    <Legend />
    {hover && hoverRow && <MapTooltip x={hover.x} y={hover.y}>
      <strong>{hoverRow.name}</strong>
      {verdict?.eligible ? <span>composite {formatComposite(result?.composite)}{rank !== undefined ? ` · eligible rank #${rank}` : ' · unranked'}</span>
        : <span className="map-tooltip-excluded">Screened out under current settings</span>}
      {[...(verdict?.reasons ?? []), ...(verdict?.warnings ?? [])].map((text) => <span className="map-tooltip-reason" key={text}>{text}</span>)}
    </MapTooltip>}
  </div>;
}
