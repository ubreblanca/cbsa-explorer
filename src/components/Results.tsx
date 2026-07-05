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
    .map((row) => ({
      row,
      rank: engine.rankById.get(row.id) ?? 0,
      composite: engine.byId.get(row.id)?.composite ?? 0,
    }))
    .sort((a, b) => a.rank - b.rank);

  return (
    <aside className="results" aria-label="Ranked results">
      <div className="results-head">
        {visible.length} of {rows.length} areas
      </div>
      <table className="results-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Area</th>
            <th scope="col" className="num">
              Score
            </th>
            <th scope="col" className="num" title="Rank change vs the baseline weights">
              Δ
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map(({ row, rank, composite }) => {
            const delta = row.v11.rank - rank;
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
                <td className="num">{rank}</td>
                <td>
                  <span className="row-name">{row.name}</span>{' '}
                  <span className={`type-chip type-${row.type}`}>{row.type}</span>
                </td>
                <td className="num">{formatComposite(composite)}</td>
                <td className={`num delta ${delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : ''}`}>
                  {delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : '–'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </aside>
  );
}
