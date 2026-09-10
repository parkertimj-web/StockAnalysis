'use strict';

/**
 * Japan ↔ US Treasury watch.
 *
 * Japan is the largest foreign holder of US Treasuries (~$1.2T). A weak yen
 * can pressure Japan to sell those reserves to buy yen — which would push US
 * yields up. This module tracks the key gauges and scores how elevated that
 * sell-off risk is, alongside the scenario framework.
 *
 * The SNAPSHOT is a curated baseline (as of the date below) so the page always
 * renders; when FRED_API_KEY is set the route overlays live USD/JPY and the
 * US policy rate on top of it.
 *
 * Educational macro context — not investment advice.
 */
const SNAPSHOT = {
  asOf: '2026-08',
  usdjpy: 159,          // JPY per USD
  usdjpy40yrLow: 163.7, // multi-decade low touched in 2026
  bojRate: 1.0,         // BOJ policy rate (%), 1995-high
  fedRate: 3.625,       // Fed funds midpoint of 3.50–3.75%
  japanHoldingsB: 1203, // Japan's US Treasury holdings, $ billions (mid-2026 TIC)
  foreignTotalT: 9.5,   // total foreign-held US Treasuries, $ trillions
  lastIntervention: '2026-07-31', // first joint US–Japan yen buy since 1998
  fimaRepo: true,       // Japan using the Fed's FIMA repo to raise USD w/o selling
};

// Four-scenario framework, from most acute to most structural.
const SCENARIOS = [
  {
    key: 'firesale', name: 'Disruptive fire-sale / weaponized dump',
    likelihood: 'Low', tone: 'low',
    usImpact: 'Would spike long-end yields — but self-defeating and the US actively counters it.',
  },
  {
    key: 'measured', name: 'Measured Treasury sales during intervention',
    likelihood: 'Moderate (capped)', tone: 'moderate',
    usImpact: 'Modest yield pressure, as in 2022 & 2024 — now largely displaced by the repo route.',
  },
  {
    key: 'repo', name: 'Borrow-not-sell: FIMA repo + deposits + joint intervention',
    likelihood: 'High — current path', tone: 'high-good',
    usImpact: 'Minimal Treasury supply hits the market; yields largely unaffected.',
  },
  {
    key: 'structural', name: 'Slow structural decline in Japanese demand',
    likelihood: 'High / ongoing', tone: 'moderate',
    usImpact: 'Gradual upward drift in US yields — the real, durable risk (not a shock).',
  },
];

const WHY_UNLIKELY = [
  'Self-defeating: selling Treasuries pushes US yields up, widening the very rate gap sinking the yen.',
  'Japan hits itself — a dump craters the value of its remaining ~$1.2T holdings.',
  'FIMA repo lets Japan raise dollars against Treasuries without selling any into the market.',
  'The US will lean against it, as the July 31 joint intervention showed.',
];
const RAISES_RISK = [
  'Yen breaking decisively past ~¥165–170 in a disorderly way',
  'FIMA repo capacity proving too small, or US–Japan coordination breaking down',
  'Fed staying higher-for-longer while the BOJ stalls — keeping the differential wide',
];
const LOWERS_RISK = [
  'BOJ continuing to hike (already 1.0%, more signaled) and/or the Fed cutting',
  'Active use of FIMA repo and dollar deposits instead of outright sales',
  'Coordinated / signaled intervention (July 31 was the first joint action since 1998)',
];

// Score how elevated the sell-off risk is right now, from the live gauges.
function scoreRisk(s) {
  const diff = s.fedRate != null && s.bojRate != null ? s.fedRate - s.bojRate : null;
  const checks = [
    {
      key: 'zone', label: 'Yen in intervention zone (USD/JPY ≥ 160)',
      present: s.usdjpy != null ? s.usdjpy >= 160 : null,
      detail: s.usdjpy != null ? `USD/JPY ${s.usdjpy.toFixed(1)}` : 'no data',
    },
    {
      key: 'disorderly', label: 'Yen near disorderly lows (within 2% of the multi-decade low)',
      present: s.usdjpy != null && s.usdjpy40yrLow ? s.usdjpy >= s.usdjpy40yrLow * 0.98 : null,
      detail: s.usdjpy != null ? `low ¥${s.usdjpy40yrLow}` : 'no data',
    },
    {
      key: 'diff', label: 'Rate differential wide (Fed − BOJ ≥ 2.5%)',
      present: diff != null ? diff >= 2.5 : null,
      detail: diff != null ? `Fed − BOJ ${diff.toFixed(2)}%` : 'no data',
    },
    {
      key: 'norepo', label: 'No repo backstop in use (forces market sales)',
      present: typeof s.fimaRepo === 'boolean' ? !s.fimaRepo : null,
      detail: s.fimaRepo ? 'FIMA repo active (mitigated)' : 'no backstop',
    },
  ];
  const known = checks.filter(c => c.present != null);
  const flags = known.filter(c => c.present).length;
  const level = flags >= 3 ? 'High' : flags >= 2 ? 'Moderate' : 'Low';
  return { checks, flags, scored: known.length, level, differential: diff };
}

module.exports = {
  SNAPSHOT, SCENARIOS, WHY_UNLIKELY, RAISES_RISK, LOWERS_RISK, scoreRisk,
};
