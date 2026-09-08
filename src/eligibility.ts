// Pure eligibility predicates. Scores always retain the fixed national reference.
import type { CbsaRow, ScreenConfig, ScreenResult } from './types';

export const DEFAULT_SCREENS: ScreenConfig = {
  humidityEnabled: true, maxDewPointF: 65,
  airportEnabled: true, gatewayMiles: 150, largeMiles: 110, mediumMiles: 60,
};

/** Defensive parsing shared by form inputs, old presets and untrusted share links. */
export function normalizeScreens(value: unknown, defaults: ScreenConfig = DEFAULT_SCREENS): ScreenConfig {
  const out = { ...defaults };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  const v = value as Record<string, unknown>;
  for (const key of ['humidityEnabled', 'airportEnabled'] as const) {
    if (typeof v[key] === 'boolean') out[key] = v[key];
  }
  for (const key of ['maxDewPointF', 'gatewayMiles', 'largeMiles', 'mediumMiles'] as const) {
    const n = v[key];
    if (typeof n === 'number' && Number.isFinite(n)) {
      out[key] = key === 'maxDewPointF' ? Math.max(-50, Math.min(100, n)) : Math.max(0, Math.min(10000, n));
    }
  }
  return out;
}

export function evaluateScreens(row: Pick<CbsaRow, 'screen'>, settings: ScreenConfig): ScreenResult {
  const s = row.screen;
  const reasons: string[] = [], warnings: string[] = [];
  if (settings.humidityEnabled) {
    if (s.dewPointF === null || !Number.isFinite(s.dewPointF)) {
      warnings.push('Humidity unknown; retained provisionally.');
    } else if (!s.humidityVerified) {
      warnings.push('Humidity is not station-verified; retained provisionally.');
    } else if (s.dewPointF >= settings.maxDewPointF) {
      reasons.push(`Humidity: station-verified dew point ${s.dewPointF.toFixed(2)}°F is at or above ${settings.maxDewPointF}°F${s.humidityStation ? ` (${s.humidityStation})` : ''}.`);
    }
  }
  if (settings.airportEnabled) {
    const tiers = [
      ['Tokyo gateway', s.gatewayMiles, settings.gatewayMiles],
      ['1M+ boardings', s.largeMiles, settings.largeMiles],
      ['250k+ boardings', s.mediumMiles, settings.mediumMiles],
    ] as const;
    const passes = tiers.some(([, d, limit]) => d !== null && Number.isFinite(d) && d <= limit);
    const unknown = tiers.some(([, d]) => d === null || !Number.isFinite(d));
    if (!passes && unknown) warnings.push('Airport distance coverage incomplete; retained provisionally.');
    if (!passes && !unknown) {
      reasons.push('Airport access: all three distance limits exceeded (' + tiers
        .map(([label, d, limit]) => `${label}: ${d!.toFixed(2)} mi > ${limit} mi`).join('; ') + ').');
    }
  }
  return { eligible: reasons.length === 0, reasons, warnings };
}
