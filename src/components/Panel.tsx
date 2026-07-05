// Left control panel: one card per registry group (enable, weight slider + input,
// core-weight share, expandable member metrics) and the display-only filters card.

import { useState } from 'react';
import { maxGroupWeight, useStore } from '../state';
import { groupParticipates } from '../engine';
import { Tooltip } from './Tooltip';
import type { GroupDef, MetricDef, Registry } from '../types';

export function Panel() {
  const registry = useStore((s) => s.registry);
  if (!registry) return <aside className="panel" />;

  const groups = [...registry.groups].sort((a, b) => a.order - b.order);
  return (
    <aside className="panel" aria-label="Scoring controls">
      {groups.map((g) => (
        <GroupCard key={g.id} registry={registry} group={g} />
      ))}
      <FiltersCard />
    </aside>
  );
}

function GroupCard({ registry, group }: { registry: Registry; group: GroupDef }) {
  const gc = useStore((s) => s.config.groups[group.id]);
  // Core-share display must match the engine's renormalization: a group only
  // counts toward the core denominator when it PARTICIPATES (enabled AND has
  // an enabled metric with weight > 0) — see groupParticipates in engine.ts.
  const participates = useStore((s) => groupParticipates(registry, s.config, group.id));
  const coreTotal = useStore((s) =>
    registry.groups.reduce((sum, g) => {
      const c = s.config.groups[g.id];
      return g.kind === 'core' && c && groupParticipates(registry, s.config, g.id)
        ? sum + c.weight
        : sum;
    }, 0),
  );
  const [expanded, setExpanded] = useState(false);
  if (!gc) return null;

  const metrics = registry.metrics.filter((m) => m.group === group.id);
  const share =
    group.kind === 'core' && participates && coreTotal > 0
      ? `${((gc.weight / coreTotal) * 100).toFixed(1)}%`
      : null;
  // Enabled but metric-emptied: the engine excludes it from the composite entirely.
  const inert = group.kind === 'core' && gc.enabled && !participates;
  const maxWeight = maxGroupWeight(registry);

  return (
    <section className={`card group-card${gc.enabled ? '' : ' is-disabled'}`}>
      <div className="group-head">
        <input
          type="checkbox"
          checked={gc.enabled}
          onChange={(e) => useStore.getState().setGroupEnabled(group.id, e.target.checked)}
          aria-label={`Enable ${group.label}`}
        />
        <Tooltip className="group-label" text={group.description || group.label}>
          {group.label}
        </Tooltip>
        {group.kind === 'bonus' ? (
          <Tooltip
            className="bonus-chip"
            text="Bonus group: added on top of the core composite, not weight-normalized."
          >
            bonus
          </Tooltip>
        ) : inert ? (
          <Tooltip
            className="group-share"
            text="All metrics in this group are disabled or zero-weighted, so the group is inert: it is excluded from the composite and the other core shares renormalize without it."
          >
            —
          </Tooltip>
        ) : (
          <span className="group-share">{share ?? '—'}</span>
        )}
        <button
          type="button"
          className="expand-btn"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${group.label} metrics`}
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>
      <div className="group-weight">
        <input
          type="range"
          min={0}
          max={maxWeight}
          step={0.5}
          value={gc.weight}
          disabled={!gc.enabled}
          onChange={(e) => useStore.getState().setGroupWeight(group.id, Number(e.target.value))}
          aria-label={`${group.label} weight`}
        />
        <input
          type="number"
          min={0}
          max={maxWeight}
          step={0.5}
          value={gc.weight}
          disabled={!gc.enabled}
          onChange={(e) => useStore.getState().setGroupWeight(group.id, Number(e.target.value))}
          aria-label={`${group.label} weight value`}
        />
      </div>
      {expanded && (
        <ul className="metric-list">
          {metrics.map((m) => (
            <MetricRow key={m.id} metric={m} />
          ))}
          {metrics.length === 0 && <li className="metric-empty">No metrics in this group.</li>}
        </ul>
      )}
    </section>
  );
}

function MetricRow({ metric }: { metric: MetricDef }) {
  const mc = useStore((s) => s.config.metrics[metric.id]);
  if (!mc) return null;

  const info = [
    metric.description,
    `Source: ${metric.source}${metric.vintage ? ` (${metric.vintage})` : ''}`,
    metric.scoring_note ? `Scoring: ${metric.scoring_note}` : '',
    `Direction: ${metric.direction} is better`,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <li className="metric-row">
      <input
        type="checkbox"
        checked={mc.enabled}
        onChange={(e) => useStore.getState().setMetricEnabled(metric.id, e.target.checked)}
        aria-label={`Enable ${metric.label}`}
      />
      <span className="metric-label">{metric.label}</span>
      <Tooltip className="info-dot" text={info} aria-label={`About ${metric.label}`}>
        i
      </Tooltip>
      <input
        type="number"
        min={0}
        step={0.5}
        value={mc.weight}
        disabled={!mc.enabled}
        onChange={(e) => useStore.getState().setMetricWeight(metric.id, Number(e.target.value))}
        aria-label={`${metric.label} sub-weight`}
      />
    </li>
  );
}

function FiltersCard() {
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  return (
    <section className="card filters-card">
      <h2 className="card-title">
        Filters <span className="card-subtitle">display only — never affects scoring</span>
      </h2>
      <label className="filter-field">
        Type
        <select
          value={filters.type}
          onChange={(e) => setFilters({ type: e.target.value as 'all' | 'metro' | 'micro' })}
        >
          <option value="all">All</option>
          <option value="metro">Metro</option>
          <option value="micro">Micro</option>
        </select>
      </label>
      <label className="filter-field">
        Min population
        <input
          type="number"
          min={0}
          step={10000}
          value={filters.minPop}
          onChange={(e) => setFilters({ minPop: Math.max(0, Number(e.target.value) || 0) })}
        />
      </label>
      <label className="filter-field">
        Search
        <input
          type="search"
          placeholder="Name or state…"
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
        />
      </label>
    </section>
  );
}
