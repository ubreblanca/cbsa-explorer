# US Metro Scoring Explorer

An interactive scoring explorer for **925 US metro and micro areas** (Census
[CBSAs](https://www.census.gov/programs-surveys/metro-micro.html)), with configurable
weights and optional eligibility screens. It started as a relocation-research
tool and is published as a data-exploration playground, not a definitive ranking.

[Open the app](https://ubreblanca.github.io/cbsa-explorer/)

## Controls

- **Eligibility screens:** independently enable/disable humidity and airport
  access, or edit their thresholds. Defaults retain 478 areas; airport only
  retains 812, humidity only 570, and disabling both permits all 925.
- **Humidity default:** exclude station-verified July-August afternoon dew point
  at or above 65°F. Gridded-only estimates remain provisionally eligible.
- **Airport default:** pass ANY of three limits: within 150 mi of a Tokyo gateway,
  110 mi of a 1M+ annual-boardings airport, or 60 mi of a 250k+ airport. These are
  straight-line distances from area reference points, not driving distances.
- **Weights:** enable/disable or reweight each group and metric independently.
  Turning off a screen does not turn off the corresponding weighted metric.
- **Presets and sharing:** saved presets and share links include screens and
  thresholds as well as weights. Old weight-only presets use default screens.
- **Map/results:** grey dashed areas fail the current screens but can still be
  inspected. Search, population and metro/micro filters narrow the displayed
  results without recalibrating scores. Areas outside CBSAs are not modeled.

## Scoring

Most metrics use **0-100 percentiles on a fixed national reference of 925 areas**.
Some use documented blends or discrete presence scores. Group scores are weighted
means; the composite is the weighted mean of active core groups plus small bonuses.

**Changing a screen changes eligibility, not numerical scores.** Ranks are among
currently eligible, scorable areas. Rank-change indicators compare customized
weights with default weights within that same eligible set, not with an older
model release. The header self-test checks the precomputed national baseline.

The criteria include road-cycling terrain and race activity, climate, demographics,
employment/startups, housing, homicide, air connectivity (including Tokyo), taxes,
environmental risks, education, and optional religion/altitude bonuses. Reweight
or disable anything that is not relevant to your use case.

## Data quality

**Rankings are provisional.** Geographic reference points, climate-station
representativeness, suppressed data, missing snow/air observations and multicampus
student counts remain limitations. Percentile arithmetic does not validate the
underlying measurements or imply meaningful differences between adjacent ranks.

Details show source/coverage warnings, including weather-station distances and
actual daily coverage percentages. Some observations use documented imputation
or fallback measures. A truly unavailable primary metric has no score; it blocks
the overall score while positively weighted, rather than being silently omitted
from that city's denominator. All current areas have computed primary inputs,
but this is not a guarantee of adequate local coverage.

The prebuilt JSON in `public/data/` comes from a private pipeline; this repository
contains only the app and public exports. Source families include:

- Census ACS, PEP and Business Formation Statistics
- NOAA/NCEI, PRISM and USGS GMTED2010
- BLS QCEW, BEA regional price parities, NBER TAXSIM and EIA
- CDC WONDER and NHTSA FARS
- BTS T-100 / Master Coordinate and FAA airport activity
- Zillow, FHFA and Census housing data
- FEMA National Risk Index, EPA air quality and insurance-market sources
- SEDA, Carnegie research designations and IPEDS
- US Religion Census, USA Cycling and BikeReg

Vintages and coverage differ by metric; consult its source notes. Data is provided
as-is without a guarantee of accuracy or fitness for any purpose. Verify important
claims against primary sources and actual neighborhoods/routes before acting.

## Development and deployment

```bash
npm ci
npm run dev
npm run build
npm run preview
```

Vite + React + TypeScript, zustand and MapLibre. Registry-driven metric controls;
client-side eligibility and weighting. GitHub Actions builds and publishes the
static app to Pages on pushes to `main`.

Underlying data belongs to the respective sources. Please attribute them if you
build on this work.
