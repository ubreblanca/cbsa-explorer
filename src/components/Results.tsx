// Right panel: ranked table of visible rows; swaps to the detail view when selected.

import { applyFilters, useStore } from '../state';
import { formatComposite } from '../format';
import { Details } from './Details';

export function Results() {
  const rows = useStore((s) => s.rows);
  const engine = useStore((s) => s.engine);
  const filters = useStore((s) => s.filters);
  const selectedId = useStore((s) => s.selectedId);

  if (selectedId) {
    return (
      <aside className="results" aria-label="Details">
        <Details id={selectedId} />
      </aside>
    );
  }
  if (!engine) return <aside className="results" />;

  const visible = applyFilters(rows, filters)
    .filter((row) => engine.eligibleIds.has(row.id))
    .map((row) => ({
      row,
      rank: engine.rankById.get(row.id),
      composite: engine.byId.get(row.id)?.composite ?? null,
    }))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.row.id.localeCompare(b.row.id));

  return (
    <aside className="results" aria-label="Ranked results">
      <div className="results-head">
        {visible.length} shown · {engine.eligibleIds.size} eligible / {rows.length} total
        <div className="screen-note">Ranks and weight deltas are within the eligible set. Scores use the fixed national reference.</div>
      </div>
      <table className="results-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Area</th>
            <th scope="col" className="num">
              Score
            </th>
            <th scope="col" className="num" title="Rank change vs default weights within the same eligible set">
              Δ
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && <tr><td colSpan={4}>No areas match. Adjust the screens or display filters.</td></tr>}
          {visible.map(({ row, rank, composite }) => {
            const baselineRank = engine.baselineRankById.get(row.id);
            const delta = baselineRank !== undefined && rank !== undefined ? baselineRank - rank : null;
            return (
              <tr
                key={row.id}
                tabIndex={0}
                onClick={() => useStore.getState().select(row.id, true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    useStore.getState().select(row.id, true);
                  }
                }}
              >
                <td className="num">{rank ?? 'N/A'}</td>
                <td>
                  <span className="row-name">{row.name}</span>{' '}
                  <span className={`type-chip type-${row.type}`}>{row.type}</span>
                </td>
                <td className="num">{formatComposite(composite)}</td>
                <td className={`num delta ${(delta ?? 0) > 0 ? 'delta-up' : (delta ?? 0) < 0 ? 'delta-down' : ''}`}>
                  {delta === null ? 'N/A' : delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : '–'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </aside>
  );
}
