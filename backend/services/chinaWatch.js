'use strict';

/**
 * China ↔ de-dollarization watch.
 *
 * Tracks China's effort to shift global trade/reserves off the dollar via four
 * levers: pricing oil in yuan (petroyuan), stockpiling gold as a sanctions-proof
 * anchor, rotating out of US Treasuries, and building non-SWIFT payment rails
 * (CIPS / mBridge / e-CNY).
 *
 * SNAPSHOT + the tonnage/holdings series are curated baselines (approximate,
 * from official monthly stats and reporting through 2026) so the page always
 * renders. The route overlays live USD/CNY from Frankfurter (ECB, no auth).
 *
 * Educational macro context — not investment advice. Figures are approximate
 * and some popular claims (e.g. a "Saudi petrodollar deal expiring") are
 * contested; see notes.
 */
const SNAPSHOT = {
  asOf: '2026-09',
  usdcny: 6.71,          // yuan per USD (live-overlaid)
  pbocGoldTonnes: 2386,  // PBoC reported gold, tonnes (record, Aug 2026)
  goldPctReserves: 8,    // gold as % of China's reserves (<10%)
  chinaUstB: 633,        // China's US Treasury holdings, $B (June 2026, 18yr low)
  ustPeakB: 1316,        // 2013 peak, $B
  yuanSwiftPct: 2.9,     // yuan share of SWIFT payments, %
  usdReservePct: 57,     // USD share of global FX reserves, % (25yr low)
  cipsThroughputT: 245,  // CIPS yuan throughput 2025, $T equivalent
};

// PBoC gold reserves trajectory (tonnes) — approximate reference points.
const GOLD_SERIES = [
  { label: '2015', value: 1762 },
  { label: '2019', value: 1948 },
  { label: '2022', value: 2010 },
  { label: '2023', value: 2235 },
  { label: '2024', value: 2280 },
  { label: '2025', value: 2320 },
  { label: '2026', value: 2386 },
];

// China's US Treasury holdings ($B) — approximate reference points.
const UST_SERIES = [
  { label: '2013', value: 1316 },
  { label: '2016', value: 1058 },
  { label: '2018', value: 1123 },
  { label: '2020', value: 1072 },
  { label: '2022', value: 867 },
  { label: '2023', value: 782 },
  { label: '2024', value: 759 },
  { label: '2025', value: 730 },
  { label: '2026', value: 633 },
];

// The four pillars of the strategy.
const PILLARS = [
  {
    key: 'petroyuan', name: 'Petroyuan — oil priced/settled in yuan',
    status: 'Early', tone: 'moderate',
    detail: 'Shanghai INE yuan crude futures since 2018; sanctioned Iran/Russia oil bought in yuan. Still <3% of oil invoicing.',
  },
  {
    key: 'gold', name: 'Gold — sanctions-proof reserve anchor',
    status: 'Active', tone: 'high',
    detail: 'PBoC on a 20+ month buying streak to a record ~2,386t — an asset that cannot be frozen or sanctioned. Still <10% of reserves.',
  },
  {
    key: 'loop', name: 'Oil → yuan → gold loop',
    status: 'Emerging', tone: 'moderate',
    detail: 'Oil sellers can convert yuan revenue into physical gold via Shanghai / Hong Kong — giving the yuan a trusted exit. Volumes modest.',
  },
  {
    key: 'rails', name: 'Treasuries out + non-SWIFT rails',
    status: 'Scaling', tone: 'high',
    detail: 'China UST holdings ~$633B (half the 2013 peak). CIPS handled ~$245T in 2025; mBridge/e-CNY expanding to HK & Macau.',
  },
];

const WHATS_REAL = [
  'Structural reserve rotation: gold up 20+ months, US Treasuries down ~50% from the 2013 peak.',
  'A working off-ramp to settle sanctioned energy trade (Iran, Russia) outside US reach.',
  'Alternative plumbing at scale — CIPS throughput ~$245T in 2025; mBridge live to Hong Kong & Macau.',
  'Gold rising as the neutral settlement asset between currency blocs.',
];
const HARD_LIMITS = [
  'Capital controls: the yuan is not freely convertible — disqualifying for true reserve status, and Beijing won’t remove them.',
  'Trust & rule of law: reserve status needs deep, open, legally-reliable markets China does not offer.',
  'Scale & network effects: yuan <3% of SWIFT vs the dollar’s dominance — a vast gap.',
  'Gold can’t fully back the yuan even at record levels (<10% of reserves); no gold-convertible yuan is on the table.',
];
const OUTLOOK = [
  'Not a dollar collapse — a slow drift toward a multipolar "blocs" currency world.',
  'A dollar bloc plus a yuan-and-gold bloc for sanctioned/aligned trade.',
  'Best read as insurance and leverage for China, not an imminent dollar replacement.',
];

// Momentum gauge — how many structural de-dollarization shifts are active now.
function scoreMomentum(s) {
  const checks = [
    {
      key: 'gold', label: 'PBoC actively accumulating gold',
      present: true, detail: `~${s.pbocGoldTonnes}t (record)`,
    },
    {
      key: 'ust', label: 'US Treasury holdings falling',
      present: s.chinaUstB < 700, detail: `$${s.chinaUstB}B vs $${s.ustPeakB}B peak`,
    },
    {
      key: 'rails', label: 'Non-SWIFT rails scaling (CIPS)',
      present: s.cipsThroughputT >= 200, detail: `CIPS ~$${s.cipsThroughputT}T/yr`,
    },
    {
      key: 'usd', label: 'USD reserve share at multi-decade low',
      present: s.usdReservePct <= 60, detail: `USD ${s.usdReservePct}% of reserves`,
    },
  ];
  const flags = checks.filter(c => c.present).length;
  const level = flags >= 3 ? 'High' : flags >= 2 ? 'Moderate' : 'Low';
  return { checks, flags, scored: checks.length, level };
}

module.exports = {
  SNAPSHOT, GOLD_SERIES, UST_SERIES, PILLARS,
  WHATS_REAL, HARD_LIMITS, OUTLOOK, scoreMomentum,
};
