// Display formatting per metric unit/decimals, plus the shared viridis ramp.

import type { MetricDef } from './types';

/** Colorblind-safe viridis-like ramp, 7 stops over t in [0, 1]. */
export const VIRIDIS: ReadonlyArray<readonly [number, string]> = [
  [0, '#440154'],
  [0.167, '#443983'],
  [0.333, '#31688e'],
  [0.5, '#21918c'],
  [0.667, '#35b779'],
  [0.833, '#90d743'],
  [1, '#fde725'],
];

/** CSS linear-gradient for the legend bar. */
export function viridisGradient(): string {
  const stops = VIRIDIS.map(([t, c]) => `${c} ${(t * 100).toFixed(1)}%`).join(', ');
  return `linear-gradient(to right, ${stops})`;
}

/** Interpolated viridis color for t in [0, 1]. */
export function viridisColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < VIRIDIS.length; i++) {
    const [t1, c1] = VIRIDIS[i]!;
    const [t0, c0] = VIRIDIS[i - 1]!;
    if (x <= t1) {
      const f = (x - t0) / (t1 - t0);
      const p0 = hexRgb(c0);
      const p1 = hexRgb(c1);
      const mix = p0.map((a, k) => Math.round(a + (p1[k]! - a) * f));
      return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
    }
  }
  return VIRIDIS[VIRIDIS.length - 1]![1];
}

function hexRgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** Format a raw metric value per its registry unit/decimals. null → em dash. */
export function formatValue(v: number | null | undefined, m: MetricDef): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'N/A';
  const num = v.toLocaleString('en-US', {
    minimumFractionDigits: m.decimals,
    maximumFractionDigits: m.decimals,
  });
  if (!m.unit) return num;
  if (m.unit === '%') return `${num}%`;
  if (m.unit.startsWith('$')) return `$${num}${m.unit.slice(1)}`; // "$" → $1,234 ; "$/mo" → $1,234/mo
  return `${num} ${m.unit}`;
}

export function formatComposite(c: number | null | undefined): string {
  return c == null || !Number.isFinite(c) ? 'N/A' : c.toFixed(1);
}

export function formatScore(s: number | null | undefined): string {
  return s == null || !Number.isFinite(s) ? 'N/A' : s.toFixed(0);
}

export function formatPop(pop: number): string {
  return Math.round(pop).toLocaleString('en-US');
}

/** Generic number with fixed decimals, for legend min/median/max. */
export function formatMeasure(v: number): string {
  return v.toFixed(1);
}
