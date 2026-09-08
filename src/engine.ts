// Fixed national metric scores; only weights aggregate and screens select eligibility.
import type { CbsaRow, Config, EngineOutput, Registry, ScoreResult, SelfTest } from './types';
import { DEFAULT_SCREENS, evaluateScreens, normalizeScreens } from './eligibility.ts';

export function defaultConfig(registry: Registry): Config {
  const groups: Config['groups'] = {}, metrics: Config['metrics'] = {};
  for (const g of registry.groups) groups[g.id] = { enabled: true, weight: g.weight };
  for (const m of registry.metrics) metrics[m.id] = { enabled: true, weight: m.weight };
  return { groups, metrics, screens: normalizeScreens(registry.screens?.defaults, DEFAULT_SCREENS) };
}

export function groupParticipates(registry: Registry, config: Config, groupId: string): boolean {
  const gc = config.groups[groupId];
  return !!gc?.enabled && registry.metrics.some((m) => m.group === groupId &&
    config.metrics[m.id]?.enabled && config.metrics[m.id]!.weight > 0);
}

/** A missing active metric blocks the composite; never renormalize per city. */
export function scoreRow(registry: Registry, config: Config, row: CbsaRow): ScoreResult {
  const groupScores: ScoreResult['groupScores'] = {};
  const missingMetrics: string[] = [], imputedMetrics: string[] = [];
  let coreNum = 0, coreDen = 0, bonus = 0;
  for (const g of registry.groups) {
    const gc = config.groups[g.id];
    groupScores[g.id] = null;
    if (!gc?.enabled) continue;
    let num = 0, den = 0, missing = false;
    for (const m of registry.metrics) {
      const mc = config.metrics[m.id];
      if (m.group !== g.id || !mc?.enabled || mc.weight <= 0) continue;
      const cell = row.m[m.id];
      den += mc.weight;
      if (cell?.s === null || cell?.s === undefined || !Number.isFinite(cell.s)) {
        missing = true;
        if (gc.weight > 0) missingMetrics.push(m.id);
      } else {
        num += mc.weight * cell.s;
        if (cell.v === null && gc.weight > 0) imputedMetrics.push(m.id);
      }
    }
    if (den <= 0) continue;
    if (missing) continue;
    const score = num / den;
    groupScores[g.id] = score;
    if (g.kind === 'core') { coreNum += gc.weight * score; coreDen += gc.weight; }
    else bonus += gc.weight * score / 100;
  }
  return { composite: missingMetrics.length ? null : (coreDen > 0 ? coreNum / coreDen : 0) + bonus,
    groupScores, missingMetrics, imputedMetrics };
}

export function rankScores(entries: { id: string; score: number | null }[]): Map<string, number> {
  const order = entries.filter((r): r is { id: string; score: number } => r.score !== null && Number.isFinite(r.score))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return new Map(order.map((r, i) => [r.id, i + 1]));
}

export function computeAll(registry: Registry, config: Config, rows: CbsaRow[]): EngineOutput {
  const byId = new Map(rows.map((r) => [r.id, scoreRow(registry, config, r)]));
  const eligibility = new Map(rows.map((r) => [r.id, evaluateScreens(r, config.screens)]));
  const eligible = rows.filter((r) => eligibility.get(r.id)!.eligible);
  return {
    byId, eligibility, eligibleIds: new Set(eligible.map((r) => r.id)),
    rankById: rankScores(eligible.map((r) => ({ id: r.id, score: byId.get(r.id)!.composite }))),
    // Same eligibility for both rankings: screen changes are not weight deltas.
    baselineRankById: rankScores(eligible.map((r) => ({ id: r.id, score: r.baseline.composite }))),
  };
}

export function selfTest(registry: Registry, rows: CbsaRow[]): SelfTest {
  const config = defaultConfig(registry);
  const diffs = rows.map((r) => {
    const computed = scoreRow(registry, config, r).composite, expected = r.baseline.composite;
    const diff = computed === null || expected === null ? (computed === expected ? 0 : Infinity) : Math.abs(computed - expected);
    return { id: r.id, name: r.name, computed, expected, diff };
  }).sort((a, b) => b.diff - a.diff);
  const maxDiff = diffs[0]?.diff ?? 0;
  return { ok: maxDiff < 1e-7, maxDiff, worst: diffs.slice(0, 10) };
}
