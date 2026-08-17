// Selected-CBSA detail view: identity, flags, composite/ranks, per-group bars
// expandable into per-metric raw values + score mini-bars. Fully registry-driven.

import { useState } from 'react';
import { useStore } from '../state';
import { formatComposite, formatPop, formatScore, formatValue, viridisColor } from '../format';
import { Tooltip } from './Tooltip';
import type { FlagDef, GroupDef, MetricDef, Registry } from '../types';

export function Details({ id }: { id: string }) {
  const registry = useStore((s) => s.registry);
  const row = useStore((s) => s.rows.find((r) => r.id === id));
  const engine = useStore((s) => s.engine);
  const config = useStore((s) => s.config);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (!registry || !row || !engine) return null;
  const score = engine.byId.get(row.id);
  const rank = engine.rankById.get(row.id);
  if (!score) return null;

  const flagDefs = new Map<string, FlagDef>(registry.flags.map((f) => [f.id, f]));
  const activeFlags = Object.entries(row.flags)
    .filter(([, on]) => on)
    .map(([fid]) => flagDefs.get(fid) ?? { id: fid, label: fid, level: 'info' as const, description: '' });

  const groups = [...registry.groups].sort((a, b) => a.order - b.order);

  return (
    <div className="details">
      <button type="button" className="back-btn" onClick={() => useStore.getState().select(null)}>
        ← Back to results
      </button>
      <h2 className="details-name">{row.name}</h2>
      <div className="details-meta">
        <span className={`type-chip type-${row.type}`}>{row.type}</span>
        <span>{row.states}</span>
        <span>pop {formatPop(row.pop)}</span>
      </div>
      {activeFlags.length > 0 && (
        <div className="details-flags">
          {activeFlags.map((f) => (
            <Tooltip
              key={f.id}
              className={`flag-badge flag-${f.level}`}
              text={f.description || f.label}
            >
              {f.label}
            </Tooltip>
          ))}
        </div>
      )}
      <div className="details-scores">
        <div className="score-big">
          <span className="score-value">{formatComposite(score.composite)}</span>
          <span className="score-caption">composite</span>
        </div>
        <div className="score-ranks">
          <span>rank #{rank ?? '—'} (current weights)</span>
          <span>
            rank #{row.baseline.rank} · {formatComposite(row.baseline.composite)} (baseline)
          </span>
        </div>
      </div>
      {groups.map((g) => (
        <GroupBar
          key={g.id}
          registry={registry}
          group={g}
          rowId={row.id}
          groupScore={score.groupScores[g.id] ?? null}
          groupWeight={config.groups[g.id]?.weight ?? g.weight}
          expanded={expanded[g.id] ?? false}
          onToggle={() => setExpanded((e) => ({ ...e, [g.id]: !(e[g.id] ?? false) }))}
        />
      ))}
    </div>
  );
}

function GroupBar(props: {
  registry: Registry;
  group: GroupDef;
  rowId: string;
  groupScore: number | null;
  groupWeight: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { registry, group, rowId, groupScore, groupWeight, expanded, onToggle } = props;
  const metrics = registry.metrics.filter((m) => m.group === group.id);
  return (
    <div className="detail-group">
      <button
        type="button"
        className="detail-group-head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="detail-group-label">
          {group.label}
          <span className="detail-group-weight">
            {group.kind === 'bonus' ? 'bonus ' : ''}w {groupWeight}
          </span>
        </span>
        <span className="detail-group-score">
          {groupScore === null ? '—' : formatScore(groupScore)}
        </span>
      </button>
      <div className="bar-track" aria-hidden="true">
        {groupScore !== null && (
          <div
            className="bar-fill"
            style={{
              width: `${Math.max(0, Math.min(100, groupScore))}%`,
              background: viridisColor(groupScore / 100),
            }}
          />
        )}
      </div>
      {expanded && (
        <ul className="detail-metrics">
          {metrics.map((m) => (
            <MetricDetail key={m.id} metric={m} rowId={rowId} />
          ))}
          {metrics.length === 0 && <li className="metric-empty">No metrics in this group.</li>}
        </ul>
      )}
    </div>
  );
}

function MetricDetail({ metric, rowId }: { metric: MetricDef; rowId: string }) {
  const cell = useStore((s) => s.rows.find((r) => r.id === rowId)?.m[metric.id]);
  const enabled = useStore((s) => s.config.metrics[metric.id]?.enabled ?? true);
  return (
    <li className={`detail-metric${enabled ? '' : ' is-disabled'}`}>
      <span className="detail-metric-label">{metric.label}</span>
      <span className="detail-metric-value">{cell ? formatValue(cell.v, metric) : '—'}</span>
      <span className="mini-bar" aria-label={`score ${cell ? formatScore(cell.s) : '—'}`}>
        <span
          className="mini-bar-fill"
          style={{
            width: `${cell ? Math.max(0, Math.min(100, cell.s)) : 0}%`,
            background: cell ? viridisColor(cell.s / 100) : 'transparent',
          }}
        />
      </span>
      <span className="detail-metric-score">{cell ? formatScore(cell.s) : '—'}</span>
    </li>
  );
}
