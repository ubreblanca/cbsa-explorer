// Scoring engine: pure functions implementing the baseline aggregation spec.
// Percentile scores are precomputed in the data; this only aggregates:
//   group = weighted mean of enabled metric scores; composite = weighted mean of
//   enabled core groups + sum(bonusWeight * bonusScore / 100).

import type {
  CbsaRow,
  Config,
  EngineOutput,
  Registry,
  ScoreResult,
  SelfTest,
} from './types';

/** Default config derived ONLY from the registry (metrics.json weights, all enabled). */
export function defaultConfig(registry: Registry): Config {
  const groups: Config['groups'] = {};
  for (const g of registry.groups) groups[g.id] = { enabled: true, weight: g.weight };
  const metrics: Config['metrics'] = {};
  for (const m of registry.metrics) metrics[m.id] = { enabled: true, weight: m.weight };
  return { groups, metrics };
}

/**
 * True when a group actually participates in the composite: enabled AND at
 * least one enabled member metric with weight > 0. This is the same predicate
 * scoreRow applies (den <= 0 drops the group from the core denominator), so UI
 * displays of core-weight shares must use it too.
 */
export function groupParticipates(registry: Registry, config: Config, groupId: string): boolean {
  const gc = config.groups[groupId];
  if (!gc || !gc.enabled) return false;
  return registry.metrics.some((m) => {
    if (m.group !== groupId) return false;
    const mc = config.metrics[m.id];
    return !!mc && mc.enabled && mc.weight > 0;
  });
}

/** Score a single row. Exported for unit testing. */
export function scoreRow(registry: Registry, config: Config, row: CbsaRow): ScoreResult {
  const groupScores: Record<string, number | null> = {};
  let coreNum = 0;
  let coreDen = 0;
  let bonus = 0;

  for (const g of registry.groups) {
    const gc = config.groups[g.id];
    if (!gc || !gc.enabled) {
      groupScores[g.id] = null;
      continue;
    }
    let num = 0;
    let den = 0;
    for (const m of registry.metrics) {
      if (m.group !== g.id) continue;
      const mc = config.metrics[m.id];
      if (!mc || !mc.enabled || mc.weight <= 0) continue;
      const cell = row.m[m.id];
      if (!cell) continue;
      num += mc.weight * cell.s;
      den += mc.weight;
    }
    if (den <= 0) {
      // No enabled metrics -> the group does not participate at all.
      groupScores[g.id] = null;
      continue;
    }
    const gScore = num / den;
    groupScores[g.id] = gScore;
    if (g.kind === 'core') {
      coreNum += gc.weight * gScore;
      coreDen += gc.weight;
    } else {
      bonus += (gc.weight * gScore) / 100;
    }
  }

  const composite = (coreDen > 0 ? coreNum / coreDen : 0) + bonus;
  return { composite, groupScores };
}

/** Score every row and rank descending by composite (1 = best; ties broken by id). */
export function computeAll(registry: Registry, config: Config, rows: CbsaRow[]): EngineOutput {
  const byId = new Map<string, ScoreResult>();
  for (const row of rows) byId.set(row.id, scoreRow(registry, config, row));

  const order = rows
    .map((r) => ({ id: r.id, composite: byId.get(r.id)!.composite }))
    .sort((a, b) => b.composite - a.composite || a.id.localeCompare(b.id));
  const rankById = new Map<string, number>();
  order.forEach((entry, i) => rankById.set(entry.id, i + 1));

  return { byId, rankById };
}

/**
 * Boot self-test: with the DEFAULT config the engine must reproduce baseline.composite
 * per row within 0.02 (legacy data used 2-dp scores; current exports use 8 dp).
 */
export function selfTest(registry: Registry, rows: CbsaRow[]): SelfTest {
  const out = computeAll(registry, defaultConfig(registry), rows);
  const diffs = rows.map((row) => {
    const computed = out.byId.get(row.id)!.composite;
    return {
      id: row.id,
      name: row.name,
      computed,
      expected: row.baseline.composite,
      diff: Math.abs(computed - row.baseline.composite),
    };
  });
  diffs.sort((a, b) => b.diff - a.diff);
  const maxDiff = diffs.length > 0 ? diffs[0]!.diff : 0;
  return { ok: maxDiff < 0.02, maxDiff, worst: diffs.slice(0, 10) };
}
