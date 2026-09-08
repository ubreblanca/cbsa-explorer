// Data loading: fetches the contract files from BASE_URL + 'data/…'.
// metrics.json / cbsas.json are required; boundaries.geojson degrades gracefully.

import type { FeatureCollection } from 'geojson';
import type { CbsaFile, Registry } from './types';

/** BASE_URL-resolved data-file URL with the per-build cache buster. */
export function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}?v=${__BUILD_ID__}`;
}

async function fetchJson<T>(path: string): Promise<T> {
  const url = dataUrl(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface LoadedData {
  registry: Registry;
  cbsas: CbsaFile;
  boundaries: FeatureCollection | null;
}

/** Load all data files. Throws a user-facing Error when the required files are missing. */
export async function loadData(): Promise<LoadedData> {
  let registry: Registry;
  let cbsas: CbsaFile;
  try {
    [registry, cbsas] = await Promise.all([
      fetchJson<Registry>('data/metrics.json'),
      fetchJson<CbsaFile>('data/cbsas.json'),
    ]);
  } catch (err) {
    throw new Error(
      'Could not load data/metrics.json + data/cbsas.json: ' +
        'the data files are missing or failed to load. ' +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Contract check: both files from the same model, rows carrying the baseline key.
  // A mismatch means a cached file from a previous deployment, not a missing one.
  if (registry.schema_version !== 2 || cbsas.schema_version !== 2 ||
      registry.model_version !== cbsas.model_version || !registry.screens?.defaults ||
      cbsas.count !== cbsas.rows.length || cbsas.count !== registry.reference_count ||
      new Set(cbsas.rows.map((r) => r.id)).size !== cbsas.count ||
      cbsas.rows.some((r) => !r.baseline || !r.screen || typeof r.screen.humidityVerified !== 'boolean' ||
        [r.screen.dewPointF, r.screen.gatewayMiles, r.screen.largeMiles, r.screen.mediumMiles,
         r.baseline.composite].some((v) => v !== null && !Number.isFinite(v)) ||
        (r.baseline.rank !== null && (!Number.isInteger(r.baseline.rank) || r.baseline.rank < 1)) ||
        registry.metrics.some((m) => {
        const c = r.m?.[m.id];
        return !c || (c.s !== null && (!Number.isFinite(c.s) || c.s < 0 || c.s > 100)) ||
          (c.v !== null && !Number.isFinite(c.v));
      }))) {
    throw new Error(
      `Data files are inconsistent with each other or this build (metrics ` +
        `${registry.model_version}, cbsas ${cbsas.model_version}), likely a stale ` +
        'cache from a previous deployment. Hard-refresh to reload.',
    );
  }

  let boundaries: FeatureCollection | null = null;
  try {
    boundaries = await fetchJson<FeatureCollection>('data/boundaries.geojson');
    const ids = new Set(boundaries.features.map((f) => String(f.properties?.['id'])));
    if (ids.size !== cbsas.count || cbsas.rows.some((r) => !ids.has(r.id))) {
      boundaries = null;
      throw new Error('Map boundaries do not match the full data universe');
    }
  } catch (err) {
    // Non-fatal: rows stay selectable from the results list; map shows basemap only.
    console.warn('boundaries.geojson unavailable (map polygons disabled).', err);
  }

  return { registry, cbsas, boundaries };
}
