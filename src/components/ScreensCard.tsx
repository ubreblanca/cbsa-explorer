import { useEffect, useState } from 'react';
import { useStore } from '../state';
import type { ScreenConfig } from '../types';

type Limit = 'maxDewPointF' | 'gatewayMiles' | 'largeMiles' | 'mediumMiles';

function LimitInput({ name, label, disabled }: { name: Limit; label: string; disabled: boolean }) {
  const value = useStore((s) => s.config.screens[name]);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label className="filter-field">
    {label}
    <input type="number" value={draft} disabled={disabled}
      min={name === 'maxDewPointF' ? -50 : 0} max={name === 'maxDewPointF' ? 100 : 10000}
      step="any" onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) {
          useStore.getState().setScreens({ [name]: e.target.valueAsNumber } as Partial<ScreenConfig>);
          const accepted = useStore.getState().config.screens[name];
          if (accepted !== e.target.valueAsNumber) setDraft(String(accepted));
        }
      }} onBlur={() => setDraft(String(useStore.getState().config.screens[name]))} />
  </label>;
}

export function ScreensCard() {
  const screens = useStore((s) => s.config.screens);
  const count = useStore((s) => s.engine?.eligibleIds.size ?? 0);
  const total = useStore((s) => s.rows.length);
  const ranked = useStore((s) => s.engine?.rankById.size ?? 0);
  const update = useStore((s) => s.setScreens);
  return <section className="card screens-card" aria-label="Eligibility screens">
    <h2 className="card-title">Eligibility screens</h2>
    <p className="screen-count" aria-live="polite">{count} of {total} areas eligible</p>
    {ranked < count && <p className="screen-note">{count - ranked} eligible areas lack data for the active criteria and are unranked.</p>}
    <label className="screen-toggle"><input type="checkbox" checked={screens.humidityEnabled}
      onChange={(e) => update({ humidityEnabled: e.target.checked })} />Humidity screen</label>
    <LimitInput name="maxDewPointF" label="Dew-point cutoff (°F)" disabled={!screens.humidityEnabled} />
    <p className="screen-note">Exclude station-verified values at or above this cutoff. Unverified estimates stay provisionally eligible.</p>
    <label className="screen-toggle"><input type="checkbox" checked={screens.airportEnabled}
      onChange={(e) => update({ airportEnabled: e.target.checked })} />Airport access screen</label>
    <LimitInput name="gatewayMiles" label="Tokyo gateway within (mi)" disabled={!screens.airportEnabled} />
    <LimitInput name="largeMiles" label="1M+ boardings airport within (mi)" disabled={!screens.airportEnabled} />
    <LimitInput name="mediumMiles" label="250k+ boardings airport within (mi)" disabled={!screens.airportEnabled} />
    <p className="screen-note">Any one airport limit is sufficient. Distances are straight-line, not driving distances.</p>
    <div className="screen-actions">
      <button type="button" onClick={() => update({ humidityEnabled: false, airportEnabled: false })}>Include all areas</button>
      <button type="button" onClick={() => useStore.getState().resetScreens()}>Reset screens</button>
    </div>
    <p className="screen-note">Scores use a fixed national reference. Screens change eligibility, not scores or weights. Saved presets and share links include these settings.</p>
  </section>;
}
