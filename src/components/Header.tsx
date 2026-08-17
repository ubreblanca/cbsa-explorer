// Header bar: title, preset dropdown, save/share/reset, engine self-test badge.

import { useState } from 'react';
import { isDefaultConfig, useStore } from '../state';

const DEFAULT_PRESET = '__default__';
const CUSTOM_SENTINEL = '__custom__';
// User-preset option values are namespaced so a preset literally named
// '__default__' / '__custom__' can never collide with the sentinels.
const PRESET_PREFIX = 'p:';

export function Header() {
  const registry = useStore((s) => s.registry);
  const config = useStore((s) => s.config);
  const activePreset = useStore((s) => s.activePreset);
  const presetNames = useStore((s) => s.presetNames);
  const selfTestResult = useStore((s) => s.selfTestResult);
  const [copied, setCopied] = useState(false);

  if (!registry) return <header className="header" />;

  const isDefault = isDefaultConfig(registry, config);
  const selectValue =
    activePreset !== null
      ? PRESET_PREFIX + activePreset
      : isDefault
        ? DEFAULT_PRESET
        : CUSTOM_SENTINEL;

  const onPresetChange = (value: string) => {
    if (value === DEFAULT_PRESET) useStore.getState().resetConfig();
    else if (value.startsWith(PRESET_PREFIX)) {
      useStore.getState().loadPreset(value.slice(PRESET_PREFIX.length));
    }
  };

  const onSaveAs = () => {
    const name = window.prompt('Preset name:');
    if (name && name.trim()) useStore.getState().savePreset(name.trim());
  };

  const onDelete = () => {
    if (!activePreset) return;
    if (window.confirm(`Delete preset "${activePreset}"?`)) {
      useStore.getState().deletePreset(activePreset);
    }
  };

  const onCopyLink = () => {
    const url = window.location.href;
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => window.prompt('Copy this link:', url));
  };

  const onBadgeClick = () => {
    if (selfTestResult && !selfTestResult.ok) {
      console.error('Engine self-test failures (worst 10):');
      console.table(selfTestResult.worst);
    }
  };

  let badge: { className: string; text: string };
  if (!isDefault) {
    badge = { className: 'badge badge-custom', text: 'custom weights' };
  } else if (selfTestResult?.ok) {
    badge = { className: 'badge badge-ok', text: 'matches baseline ✓' };
  } else {
    badge = {
      className: 'badge badge-fail',
      text: `differs from baseline (max Δ ${selfTestResult ? selfTestResult.maxDiff.toFixed(3) : '?'})`,
    };
  }

  return (
    <header className="header">
      <h1 className="header-title">US Metro Scoring Explorer</h1>
      <div className="header-actions">
        <label className="header-preset">
          <span className="visually-hidden">Preset</span>
          <select
            value={selectValue}
            onChange={(e) => onPresetChange(e.target.value)}
            aria-label="Preset"
          >
            <option value={DEFAULT_PRESET}>Baseline</option>
            {presetNames.map((name) => (
              <option key={name} value={PRESET_PREFIX + name}>
                {name}
              </option>
            ))}
            {selectValue === CUSTOM_SENTINEL && <option value={CUSTOM_SENTINEL}>custom…</option>}
          </select>
        </label>
        <button type="button" onClick={onSaveAs}>
          Save as…
        </button>
        <button type="button" onClick={onDelete} disabled={!activePreset}>
          Delete
        </button>
        <button type="button" onClick={onCopyLink}>
          {copied ? 'Copied!' : 'Copy share link'}
        </button>
        <button
          type="button"
          className={badge.className}
          onClick={onBadgeClick}
          title={
            selfTestResult && !selfTestResult.ok
              ? 'Click to log the worst offenders to the console'
              : 'Default weights reproduce the precomputed baseline composite scores'
          }
        >
          {badge.text}
        </button>
      </div>
    </header>
  );
}
