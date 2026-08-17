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
      'Could not load data/metrics.json + data/cbsas.json — ' +
        'the data files are missing or failed to load. ' +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Contract check: both files from the same model, rows carrying the baseline key.
  // A mismatch means a cached file from a previous deployment, not a missing one.
  if (registry.model_version !== cbsas.model_version || !cbsas.rows[0]?.baseline) {
    throw new Error(
      `Data files are inconsistent with each other or this build (metrics ` +
        `${registry.model_version}, cbsas ${cbsas.model_version}) — likely a stale ` +
        'cache from a previous deployment. Hard-refresh to reload.',
    );
  }

  let boundaries: FeatureCollection | null = null;
  try {
    boundaries = await fetchJson<FeatureCollection>('data/boundaries.geojson');
  } catch (err) {
    // Non-fatal: rows stay selectable from the results list; map shows basemap only.
    console.warn('boundaries.geojson unavailable — map polygons disabled.', err);
  }

  return { registry, cbsas, boundaries };
}
