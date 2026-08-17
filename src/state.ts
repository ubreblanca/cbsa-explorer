// Zustand store: loaded data, user config (weights/toggles), display filters,
// selection, colorBy, URL-hash share links (diff-from-default), localStorage presets.
// Scores recompute via a requestAnimationFrame-debounced engine run.

import { create } from 'zustand';
import { computeAll, defaultConfig, selfTest } from './engine';
import { loadData } from './data';
import type { FeatureCollection } from 'geojson';
import type {
  CbsaRow,
  ColorBy,
  Config,
  EngineOutput,
  Filters,
  Registry,
  SelfTest,
} from './types';

const PRESETS_KEY = 'cities-scoring-presets-v1';
const SHOW_EXCLUDED_KEY = 'cities-show-excluded-v1';

function readShowExcluded(): boolean {
  try {
    return window.localStorage.getItem(SHOW_EXCLUDED_KEY) !== '0';
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (also used by components)

/** Display-only filtering; never affects scoring. */
export function applyFilters(rows: CbsaRow[], filters: Filters): CbsaRow[] {
  const q = filters.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (filters.type !== 'all' && r.type !== filters.type) return false;
    if (r.pop < filters.minPop) return false;
    if (q && !`${r.name} ${r.states}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Value of the current color-by measure for one row (null when unavailable). */
export function getMeasure(row: CbsaRow, engine: EngineOutput, colorBy: ColorBy): number | null {
  if (colorBy.kind === 'composite') return engine.byId.get(row.id)?.composite ?? null;
  if (colorBy.kind === 'group') return engine.byId.get(row.id)?.groupScores[colorBy.id] ?? null;
  return row.m[colorBy.id]?.s ?? null;
}

/** Human label of the current color-by measure. */
export function colorByLabel(registry: Registry, colorBy: ColorBy): string {
  if (colorBy.kind === 'composite') return 'Composite score';
  if (colorBy.kind === 'group') {
    return registry.groups.find((g) => g.id === colorBy.id)?.label ?? colorBy.id;
  }
  return registry.metrics.find((m) => m.id === colorBy.id)?.label ?? colorBy.id;
}

export function serializeColorBy(c: ColorBy): string {
  if (c.kind === 'composite') return 'composite';
  return `${c.kind === 'group' ? 'g' : 'm'}:${c.id}`;
}

export function parseColorBy(s: string, registry: Registry): ColorBy {
  if (s.startsWith('g:')) {
    const id = s.slice(2);
    if (registry.groups.some((g) => g.id === id)) return { kind: 'group', id };
  } else if (s.startsWith('m:')) {
    const id = s.slice(2);
    if (registry.metrics.some((m) => m.id === id)) return { kind: 'metric', id };
  }
  return { kind: 'composite' };
}

// ---------------------------------------------------------------------------
// URL-hash share links: compact base64url JSON of the DIFF from default config.

interface HashPayload {
  /** group id -> [weight, enabled 0|1], only entries that differ from default */
  g?: Record<string, [number, number]>;
  /** metric id -> [weight, enabled 0|1] */
  m?: Record<string, [number, number]>;
  /** colorBy, when not composite */
  c?: string;
}

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

function configDiff(registry: Registry, config: Config, colorBy: ColorBy): HashPayload {
  const def = defaultConfig(registry);
  const payload: HashPayload = {};
  const g: NonNullable<HashPayload['g']> = {};
  for (const grp of registry.groups) {
    const cur = config.groups[grp.id];
    const d = def.groups[grp.id];
    if (cur && d && (cur.weight !== d.weight || cur.enabled !== d.enabled)) {
      g[grp.id] = [cur.weight, cur.enabled ? 1 : 0];
    }
  }
  const m: NonNullable<HashPayload['m']> = {};
  for (const met of registry.metrics) {
    const cur = config.metrics[met.id];
    const d = def.metrics[met.id];
    if (cur && d && (cur.weight !== d.weight || cur.enabled !== d.enabled)) {
      m[met.id] = [cur.weight, cur.enabled ? 1 : 0];
    }
  }
  if (Object.keys(g).length > 0) payload.g = g;
  if (Object.keys(m).length > 0) payload.m = m;
  if (colorBy.kind !== 'composite') payload.c = serializeColorBy(colorBy);
  return payload;
}

/** Overlay a (possibly stale) partial payload onto the registry defaults. */
function applyPayload(registry: Registry, payload: HashPayload): Config {
  const config = defaultConfig(registry);
  const maxW = maxGroupWeight(registry);
  for (const [id, entry] of Object.entries(payload.g ?? {})) {
    if (config.groups[id] && Array.isArray(entry) && entry.length === 2) {
      config.groups[id] = { weight: clampWeight(entry[0], maxW), enabled: entry[1] !== 0 };
    }
  }
  for (const [id, entry] of Object.entries(payload.m ?? {})) {
    if (config.metrics[id] && Array.isArray(entry) && entry.length === 2) {
      config.metrics[id] = { weight: Math.max(0, Number(entry[0]) || 0), enabled: entry[1] !== 0 };
    }
  }
  return config;
}

/**
 * Group-weight ceiling, derived from the registry so a future group with a
 * larger default weight stays adjustable and restorable. Single source for the
 * panel slider/number-input max AND share-link/preset clamping.
 */
export function maxGroupWeight(registry: Registry | null): number {
  if (!registry || registry.groups.length === 0) return 40;
  return Math.max(40, 2 * Math.max(...registry.groups.map((g) => g.weight)));
}

function clampWeight(w: number, max: number): number {
  const n = Number(w);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, n));
}

export function isDefaultConfig(registry: Registry, config: Config): boolean {
  const d = configDiff(registry, config, { kind: 'composite' });
  return !d.g && !d.m;
}

/**
 * Engine run for the store. With the untouched default config, displayed ranks are
 * the authoritative baseline ranks: the shipped 2-dp scores can flip a few near-tie
 * adjacent pairs, which would otherwise show spurious ±1 delta chips at default.
 */
function runEngine(registry: Registry, config: Config, rows: CbsaRow[]): EngineOutput {
  const out = computeAll(registry, config, rows);
  if (isDefaultConfig(registry, config)) {
    for (const row of rows) out.rankById.set(row.id, row.baseline.rank);
  }
  return out;
}

function syncHash(registry: Registry, config: Config, colorBy: ColorBy): void {
  const payload = configDiff(registry, config, colorBy);
  const empty = !payload.g && !payload.m && !payload.c;
  const url = new URL(window.location.href);
  url.hash = empty ? '' : `c=${b64urlEncode(JSON.stringify(payload))}`;
  window.history.replaceState(null, '', url.toString());
}

function readHash(registry: Registry): { config: Config; colorBy: ColorBy } | null {
  const match = /^#?c=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
  if (!match || !match[1]) return null;
  try {
    const payload = JSON.parse(b64urlDecode(match[1])) as HashPayload;
    return {
      config: applyPayload(registry, payload),
      colorBy: payload.c ? parseColorBy(payload.c, registry) : { kind: 'composite' },
    };
  } catch (err) {
    console.warn('Ignoring unparseable share-link hash.', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// localStorage presets

type PresetStore = Record<string, HashPayload>;

function readPresetStore(): PresetStore {
  try {
    const raw = window.localStorage.getItem(PRESETS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as PresetStore;
  } catch (err) {
    console.warn('Could not read presets from localStorage.', err);
  }
  return {};
}

function writePresetStore(store: PresetStore): void {
  try {
    window.localStorage.setItem(PRESETS_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn('Could not persist presets to localStorage.', err);
  }
}

// ---------------------------------------------------------------------------
// Store

export interface AppState {
  loading: boolean;
  loadError: string | null;
  registry: Registry | null;
  rows: CbsaRow[];
  boundaries: FeatureCollection | null;
  selfTestResult: SelfTest | null;

  config: Config;
  engine: EngineOutput | null;
  activePreset: string | null;
  presetNames: string[];
  colorBy: ColorBy;
  filters: Filters;
  selectedId: string | null;
  /** Increments when a selection should trigger a map flyTo (list clicks, not map clicks). */
  flyNonce: number;

  // UI slice — display-only, never part of scoring config, share hashes, or presets.
  /** Show the muted screened-out CBSA map layer (persisted to localStorage). */
  showExcluded: boolean;
  /** Feature count of the loaded excluded layer; null until (unless) it loads. */
  excludedCount: number | null;

  loadAll: () => Promise<void>;
  setGroupEnabled: (id: string, enabled: boolean) => void;
  setGroupWeight: (id: string, weight: number) => void;
  setMetricEnabled: (id: string, enabled: boolean) => void;
  setMetricWeight: (id: string, weight: number) => void;
  resetConfig: () => void;
  savePreset: (name: string) => void;
  loadPreset: (name: string) => void;
  deletePreset: (name: string) => void;
  setColorBy: (colorBy: ColorBy) => void;
  setFilters: (patch: Partial<Filters>) => void;
  select: (id: string | null, fly?: boolean) => void;
  setShowExcluded: (show: boolean) => void;
  setExcludedCount: (count: number) => void;
}

export const useStore = create<AppState>()((set, get) => {
  let raf = 0;

  /** rAF-debounced engine recompute (slider drags coalesce to one run per frame). */
  const scheduleRecompute = () => {
    if (raf !== 0) return;
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      const { registry, rows, config } = get();
      if (!registry) return;
      set({ engine: runEngine(registry, config, rows) });
    });
  };

  /** Apply a config mutation: recompute, drop preset association, refresh share hash. */
  const applyConfig = (config: Config) => {
    const { registry, colorBy } = get();
    set({ config, activePreset: null });
    if (registry) syncHash(registry, config, colorBy);
    scheduleRecompute();
  };

  return {
    loading: true,
    loadError: null,
    registry: null,
    rows: [],
    boundaries: null,
    selfTestResult: null,

    config: { groups: {}, metrics: {} },
    engine: null,
    activePreset: null,
    presetNames: Object.keys(readPresetStore()).sort(),
    colorBy: { kind: 'composite' },
    filters: { type: 'all', minPop: 0, search: '' },
    selectedId: null,
    flyNonce: 0,
    showExcluded: readShowExcluded(),
    excludedCount: null,

    loadAll: async () => {
      try {
        const { registry, cbsas, boundaries } = await loadData();
        const fromHash = readHash(registry);
        const config = fromHash?.config ?? defaultConfig(registry);
        const colorBy = fromHash?.colorBy ?? { kind: 'composite' as const };
        set({
          loading: false,
          registry,
          rows: cbsas.rows,
          boundaries,
          config,
          colorBy,
          engine: runEngine(registry, config, cbsas.rows),
          selfTestResult: selfTest(registry, cbsas.rows),
        });
      } catch (err) {
        set({ loading: false, loadError: err instanceof Error ? err.message : String(err) });
      }
    },

    setGroupEnabled: (id, enabled) => {
      const { config } = get();
      const cur = config.groups[id];
      if (!cur) return;
      applyConfig({ ...config, groups: { ...config.groups, [id]: { ...cur, enabled } } });
    },

    setGroupWeight: (id, weight) => {
      const { config, registry } = get();
      const cur = config.groups[id];
      if (!cur) return;
      applyConfig({
        ...config,
        groups: {
          ...config.groups,
          [id]: { ...cur, weight: clampWeight(weight, maxGroupWeight(registry)) },
        },
      });
    },

    setMetricEnabled: (id, enabled) => {
      const { config } = get();
      const cur = config.metrics[id];
      if (!cur) return;
      applyConfig({ ...config, metrics: { ...config.metrics, [id]: { ...cur, enabled } } });
    },

    setMetricWeight: (id, weight) => {
      const { config } = get();
      const cur = config.metrics[id];
      if (!cur) return;
      const w = Math.max(0, Number.isFinite(weight) ? weight : 0);
      applyConfig({ ...config, metrics: { ...config.metrics, [id]: { ...cur, weight: w } } });
    },

    resetConfig: () => {
      const { registry } = get();
      if (!registry) return;
      const config = defaultConfig(registry);
      const colorBy: ColorBy = { kind: 'composite' };
      set({ config, colorBy, activePreset: null });
      syncHash(registry, config, colorBy); // hash clears: no diff, composite colorBy
      scheduleRecompute();
    },

    savePreset: (name) => {
      const { registry, config, colorBy } = get();
      if (!registry || !name.trim()) return;
      const store = readPresetStore();
      store[name.trim()] = configDiff(registry, config, colorBy);
      writePresetStore(store);
      set({ presetNames: Object.keys(store).sort(), activePreset: name.trim() });
    },

    loadPreset: (name) => {
      const { registry, colorBy } = get();
      if (!registry) return;
      const payload = readPresetStore()[name];
      if (!payload) return;
      const config = applyPayload(registry, payload);
      const nextColorBy = payload.c ? parseColorBy(payload.c, registry) : colorBy;
      set({ config, colorBy: nextColorBy, activePreset: name });
      syncHash(registry, config, nextColorBy);
      scheduleRecompute();
    },

    deletePreset: (name) => {
      const store = readPresetStore();
      delete store[name];
      writePresetStore(store);
      set((s) => ({
        presetNames: Object.keys(store).sort(),
        activePreset: s.activePreset === name ? null : s.activePreset,
      }));
    },

    setColorBy: (colorBy) => {
      const { registry, config } = get();
      set({ colorBy });
      if (registry) syncHash(registry, config, colorBy);
    },

    setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),

    select: (id, fly = false) =>
      set((s) => ({ selectedId: id, flyNonce: fly && id ? s.flyNonce + 1 : s.flyNonce })),

    setShowExcluded: (show) => {
      set({ showExcluded: show });
      try {
        window.localStorage.setItem(SHOW_EXCLUDED_KEY, show ? '1' : '0');
      } catch {
        // localStorage unavailable — the toggle still works for this session.
      }
    },

    setExcludedCount: (count) => set({ excludedCount: count }),
  };
});
