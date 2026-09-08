// TypeScript types for the full data contract (metrics.json, cbsas.json) plus
// app-side config/preset shapes. This file IS the contract, typed.

export type GroupKind = 'core' | 'bonus';
export type Direction = 'higher' | 'lower';
export type FlagLevel = 'warn' | 'info';
export type CbsaType = 'metro' | 'micro';

/** One entry of metrics.json "groups". */
export interface GroupDef {
  id: string;
  label: string;
  kind: GroupKind;
  weight: number;
  order: number;
  description: string;
}

/** One entry of metrics.json "metrics". */
export interface MetricDef {
  id: string;
  group: string;
  label: string;
  weight: number;
  direction: Direction;
  unit: string;
  decimals: number;
  source: string;
  vintage: string;
  scoring_note: string;
  description: string;
  missing_count?: number;
  unscored_count?: number;
}

/** One entry of metrics.json "flags". */
export interface FlagDef {
  id: string;
  label: string;
  level: FlagLevel;
  description: string;
}

/** metrics.json — the registry that drives the whole UI. */
export interface Registry {
  schema_version: number;
  model_version: string;
  generated: string;
  notice?: string;
  score_decimals?: number;
  reference_count: number;
  screens: { defaults: ScreenConfig };
  groups: GroupDef[];
  metrics: MetricDef[];
  flags: FlagDef[];
}

/** Per-metric cell in a cbsas.json row: raw display value + precomputed 0-100 percentile score. */
export interface MetricCell {
  v: number | null;
  /** null means genuinely unavailable, not an imputed average. */
  s: number | null;
}

export interface ScreenConfig {
  humidityEnabled: boolean;
  maxDewPointF: number;
  airportEnabled: boolean;
  gatewayMiles: number;
  largeMiles: number;
  mediumMiles: number;
}

export interface ScreenInputs {
  dewPointF: number | null;
  humidityVerified: boolean;
  humidityStation: string | null;
  gatewayMiles: number | null;
  largeMiles: number | null;
  mediumMiles: number | null;
}

export interface ScreenResult {
  eligible: boolean;
  reasons: string[];
  warnings: string[];
}

/** One entry of cbsas.json "rows". */
export interface CbsaRow {
  id: string;
  name: string;
  type: CbsaType;
  states: string;
  pop: number;
  /** Census Gazetteer internal point of the whole CBSA — NOT the principal
   *  city; map flyTo may land off-city for large/asymmetric CBSAs. */
  lat: number;
  lon: number;
  flags: Record<string, boolean>;
  coverage_notes?: string[];
  m: Record<string, MetricCell>;
  screen: ScreenInputs;
  /** National default-weight baseline, NOT a rank in the current eligible set. */
  baseline: { composite: number | null; rank: number | null };
}

/** cbsas.json top level. */
export interface CbsaFile {
  schema_version: number;
  model_version: string;
  generated: string;
  count: number;
  rows: CbsaRow[];
}

// ---------------------------------------------------------------------------
// App-side configuration (user-adjustable weights/toggles)

export interface GroupConfig {
  enabled: boolean;
  weight: number;
}

export interface MetricConfig {
  enabled: boolean;
  weight: number;
}

export interface Config {
  groups: Record<string, GroupConfig>;
  metrics: Record<string, MetricConfig>;
  screens: ScreenConfig;
}

/** Result of one engine run for a single CBSA. */
export interface ScoreResult {
  /** 0-100-ish composite (bonus groups add on top). */
  composite: number | null;
  missingMetrics: string[];
  imputedMetrics: string[];
  /** Group id -> aggregated 0-100 score, or null when the group has no enabled metrics. */
  groupScores: Record<string, number | null>;
}

/** Full engine output over all rows. */
export interface EngineOutput {
  byId: Map<string, ScoreResult>;
  /** Ranks among eligible, scorable rows; search/type/population do not change ranks. */
  rankById: Map<string, number>;
  baselineRankById: Map<string, number>;
  eligibility: Map<string, ScreenResult>;
  eligibleIds: Set<string>;
}

/** Display-only filters (never affect scoring). */
export interface Filters {
  type: 'all' | CbsaType;
  minPop: number;
  search: string;
}

/** What the map is colored by: composite, a group score, or a single metric score. */
export type ColorBy =
  | { kind: 'composite' }
  | { kind: 'group'; id: string }
  | { kind: 'metric'; id: string };

/** Engine self-test result computed on boot against baseline composites. */
export interface SelfTest {
  ok: boolean;
  maxDiff: number;
  worst: Array<{ id: string; name: string; computed: number | null; expected: number | null; diff: number }>;
}
