// Map legend: viridis gradient + min/median/max of the current measure over
// visible rows, plus the toggle/swatch for the muted screened-out layer.

import { applyFilters, colorByLabel, getMeasure, useStore } from '../state';
import { formatMeasure, viridisGradient } from '../format';

/** Toggle + swatch + footnote for the excluded layer; hidden until it loads. */
function ExcludedRows() {
  const showExcluded = useStore((s) => s.showExcluded);
  const excludedCount = useStore((s) => s.excludedCount);
  const setShowExcluded = useStore((s) => s.setShowExcluded);
  if (excludedCount === null) return null;

  return (
    <>
      <label className="legend-toggle">
        <input
          type="checkbox"
          checked={showExcluded}
          onChange={(e) => setShowExcluded(e.target.checked)}
        />
        Show excluded areas
      </label>
      {showExcluded && (
        <>
          <div className="legend-excluded-row">
            <span className="legend-swatch-excluded" aria-hidden="true" />
            <span>Screened out ({excludedCount})</span>
          </div>
          <div className="legend-footnote">
            Remaining blank areas are counties outside any CBSA (no scoring unit).
          </div>
        </>
      )}
    </>
  );
}

export function Legend() {
  const registry = useStore((s) => s.registry);
  const rows = useStore((s) => s.rows);
  const engine = useStore((s) => s.engine);
  const colorBy = useStore((s) => s.colorBy);
  const filters = useStore((s) => s.filters);
  if (!registry || !engine) return null;

  const vals = applyFilters(rows, filters)
    .map((r) => getMeasure(r, engine, colorBy))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  if (vals.length === 0) {
    return (
      <div className="legend">
        <div className="legend-title">{colorByLabel(registry, colorBy)}</div>
        <div className="legend-empty">No visible areas</div>
        <ExcludedRows />
      </div>
    );
  }

  const min = vals[0]!;
  const max = vals[vals.length - 1]!;
  const median =
    vals.length % 2 === 1
      ? vals[(vals.length - 1) / 2]!
      : (vals[vals.length / 2 - 1]! + vals[vals.length / 2]!) / 2;

  return (
    <div className="legend">
      <div className="legend-title">{colorByLabel(registry, colorBy)}</div>
      <div className="legend-bar" style={{ background: viridisGradient() }} />
      <div className="legend-scale">
        <span>{formatMeasure(min)}</span>
        <span>{formatMeasure(median)}</span>
        <span>{formatMeasure(max)}</span>
      </div>
      <ExcludedRows />
    </div>
  );
}
