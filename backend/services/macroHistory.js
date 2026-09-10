'use strict';

/**
 * Historical equity corrections (S&P 500 and predecessor indices) of roughly
 * 15%+ peak-to-trough over the last ~100 years, with the interest-rate and
 * macro backdrop around each episode.
 *
 * All figures are APPROXIMATE, widely-cited historical readings taken at or
 * near the market peak — they are for study/context, not precise data points.
 * Pre-1954 there was no federal funds rate (the market was created in 1954),
 * so `fedFunds` is null for those and the policy stance is described in notes.
 *
 * rateRegime: the Fed's stance heading INTO the peak — 'hiking' | 'cutting' |
 *             'holding'.
 * curveInverted: was the 10y-2y (or 10y-3m) curve inverted in the ~18 months
 *                before the peak? null = not meaningful / not available.
 */
const EPISODES = [
  {
    id: '1929', name: 'Great Crash of 1929', peak: '1929-09', trough: '1932-06',
    drawdownPct: -86, fedFunds: null, tenYear: 3.6, curveInverted: null,
    cpiYoY: 0.0, unemployment: 3, rateRegime: 'hiking', recessionFollowed: true,
    trigger: 'Speculative bubble; Fed discount-rate hikes; banking collapse',
    notes: 'No fed funds rate yet. Fed raised the discount rate to 6% in Aug 1929. Onset of the Great Depression; CPI turned to deep deflation.',
  },
  {
    id: '1937', name: 'Recession of 1937–38', peak: '1937-03', trough: '1938-03',
    drawdownPct: -54, fedFunds: null, tenYear: 2.7, curveInverted: null,
    cpiYoY: 3.6, unemployment: 14, rateRegime: 'hiking', recessionFollowed: true,
    trigger: 'Premature fiscal + monetary tightening',
    notes: 'Fed doubled reserve requirements 1936–37; fiscal pullback. Slid back into recession and deflation.',
  },
  {
    id: '1946', name: 'Post-war Drop of 1946', peak: '1946-05', trough: '1947-05',
    drawdownPct: -28, fedFunds: null, tenYear: 2.2, curveInverted: null,
    cpiYoY: 18, unemployment: 3.9, rateRegime: 'holding', recessionFollowed: true,
    trigger: 'Demobilization; post-war inflation surge',
    notes: 'Rates still pegged by the Fed–Treasury accord era. Inflation spiked as wartime price controls ended.',
  },
  {
    id: '1962', name: 'Kennedy Slide of 1962', peak: '1961-12', trough: '1962-06',
    drawdownPct: -28, fedFunds: 2.7, tenYear: 3.9, curveInverted: false,
    cpiYoY: 1.1, unemployment: 5.5, rateRegime: 'holding', recessionFollowed: false,
    trigger: 'Overvaluation; steel-price confrontation',
    notes: 'A valuation-driven "flash" bear with no recession; low inflation backdrop.',
  },
  {
    id: '1966', name: 'Credit Crunch of 1966', peak: '1966-02', trough: '1966-10',
    drawdownPct: -22, fedFunds: 5.4, tenYear: 4.9, curveInverted: false,
    cpiYoY: 3.4, unemployment: 3.8, rateRegime: 'hiking', recessionFollowed: false,
    trigger: 'Fed tightening; bank credit crunch',
    notes: 'A "growth recession" — Fed tightening squeezed credit but no official recession followed.',
  },
  {
    id: '1970', name: 'Bear of 1968–70', peak: '1968-11', trough: '1970-05',
    drawdownPct: -36, fedFunds: 9.0, tenYear: 7.4, curveInverted: true,
    cpiYoY: 6.0, unemployment: 3.5, rateRegime: 'hiking', recessionFollowed: true,
    trigger: 'Rising inflation; Fed tightening',
    notes: 'Inflation accelerating; fed funds peaked near 9%. Recession 1969–70.',
  },
  {
    id: '1974', name: 'Oil-Crisis Bear 1973–74', peak: '1973-01', trough: '1974-10',
    drawdownPct: -48, fedFunds: 13, tenYear: 7.4, curveInverted: true,
    cpiYoY: 11, unemployment: 5, rateRegime: 'hiking', recessionFollowed: true,
    trigger: 'OPEC oil embargo; stagflation',
    notes: 'Fed funds peaked ~13% in 1974; CPI into double digits. Classic stagflation bear.',
  },
  {
    id: '1980', name: 'Volcker Shock 1980', peak: '1980-02', trough: '1980-03',
    drawdownPct: -17, fedFunds: 18, tenYear: 12.8, curveInverted: true,
    cpiYoY: 14, unemployment: 6.3, rateRegime: 'hiking', recessionFollowed: true,
    trigger: 'Volcker rate shock; credit controls',
    notes: 'Fed funds spiked toward 18–20%; brief sharp recession (Jan–Jul 1980).',
  },
  {
    id: '1982', name: 'Disinflation Bear 1981–82', peak: '1980-11', trough: '1982-08',
    drawdownPct: -27, fedFunds: 19, tenYear: 14.5, curveInverted: true,
    cpiYoY: 10, unemployment: 10.8, rateRegime: 'hiking', recessionFollowed: true,
    trigger: 'Volcker disinflation campaign',
    notes: 'Fed funds ~19% at the peak then fell hard; unemployment peaked 10.8%. Severe recession.',
  },
  {
    id: '1987', name: 'Black Monday 1987', peak: '1987-08', trough: '1987-12',
    drawdownPct: -34, fedFunds: 7.3, tenYear: 9.5, curveInverted: false,
    cpiYoY: 4.4, unemployment: 6.0, rateRegime: 'hiking', recessionFollowed: false,
    trigger: 'Portfolio insurance; sharply rising long rates',
    notes: 'Oct 19 fell ~20% in one day. 10y yield had spiked toward 10%. No recession followed.',
  },
  {
    id: '1990', name: 'Gulf-War Bear 1990', peak: '1990-07', trough: '1990-10',
    drawdownPct: -20, fedFunds: 8.0, tenYear: 8.6, curveInverted: false,
    cpiYoY: 6.3, unemployment: 5.5, rateRegime: 'holding', recessionFollowed: true,
    trigger: 'Gulf-War oil spike; S&L crisis',
    notes: 'Oil price shock plus savings-and-loan stress; recession Jul 1990–Mar 1991.',
  },
  {
    id: '1998', name: 'LTCM / Russia 1998', peak: '1998-07', trough: '1998-10',
    drawdownPct: -19, fedFunds: 5.5, tenYear: 4.7, curveInverted: false,
    cpiYoY: 1.5, unemployment: 4.5, rateRegime: 'cutting', recessionFollowed: false,
    trigger: 'Russian default; LTCM hedge-fund collapse',
    notes: 'Credit spreads blew out; Fed cut 3× and the market recovered quickly.',
  },
  {
    id: '2002', name: 'Dot-com Bust 2000–02', peak: '2000-03', trough: '2002-10',
    drawdownPct: -49, fedFunds: 6.5, tenYear: 6.0, curveInverted: true,
    cpiYoY: 3.4, unemployment: 4.0, rateRegime: 'hiking', recessionFollowed: true,
    trigger: 'Tech bubble; Fed hikes; 9/11; accounting scandals',
    notes: 'Fed funds 6.5% at the 2000 peak, cut to 1.75%. Curve inverted in 2000. Recession 2001.',
  },
  {
    id: '2009', name: 'Global Financial Crisis 2007–09', peak: '2007-10', trough: '2009-03',
    drawdownPct: -57, fedFunds: 5.25, tenYear: 4.6, curveInverted: true,
    cpiYoY: 3.5, unemployment: 4.7, rateRegime: 'cutting', recessionFollowed: true,
    trigger: 'Subprime housing bust; Lehman failure',
    notes: 'Curve inverted 2006; HY credit spreads later hit ~20%. Fed funds 5.25%→~0. Unemployment to 10%.',
  },
  {
    id: '2011', name: 'Euro Crisis / US Downgrade 2011', peak: '2011-04', trough: '2011-10',
    drawdownPct: -19, fedFunds: 0.1, tenYear: 3.0, curveInverted: false,
    cpiYoY: 3.8, unemployment: 9.0, rateRegime: 'holding', recessionFollowed: false,
    trigger: 'Eurozone debt crisis; US debt-ceiling downgrade',
    notes: 'Zero-rate era (ZIRP); a confidence shock rather than a rate-driven bear.',
  },
  {
    id: '2018', name: 'Q4 2018 Selloff', peak: '2018-09', trough: '2018-12',
    drawdownPct: -20, fedFunds: 2.4, tenYear: 3.2, curveInverted: false,
    cpiYoY: 2.2, unemployment: 3.7, rateRegime: 'hiking', recessionFollowed: false,
    trigger: 'Fed hikes + quantitative tightening; trade war',
    notes: 'Fed hiking and shrinking its balance sheet; the curve inverted shortly after, in 2019.',
  },
  {
    id: '2020', name: 'COVID Crash 2020', peak: '2020-02', trough: '2020-03',
    drawdownPct: -34, fedFunds: 1.6, tenYear: 1.5, curveInverted: false,
    cpiYoY: 2.3, unemployment: 3.5, rateRegime: 'cutting', recessionFollowed: true,
    trigger: 'Pandemic shock',
    notes: 'Fastest -30% in history (~33 days). Curve had briefly inverted in 2019. Fed cut to zero.',
  },
  {
    id: '2022', name: 'Inflation / Rate Shock 2022', peak: '2022-01', trough: '2022-10',
    drawdownPct: -25, fedFunds: 0.25, tenYear: 1.5, curveInverted: true,
    cpiYoY: 7.5, unemployment: 3.9, rateRegime: 'hiking', recessionFollowed: false,
    trigger: 'Inflation surge; fastest Fed hiking cycle since 1980',
    notes: 'Fed funds 0→4.25%+ during 2022; CPI peaked 9.1%. Curve deeply inverted. No official recession.',
  },
];

// ── Pearson correlation over paired numeric samples ─────────────────────────
function pearson(pairs) {
  const xs = pairs.map(p => p[0]);
  const ys = pairs.map(p => p[1]);
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

function avg(nums) {
  const v = nums.filter(x => x != null && !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// ── Summary statistics + correlations across the episodes ───────────────────
function computeSummary() {
  const withFunds = EPISODES.filter(e => e.fedFunds != null);
  const invKnown  = EPISODES.filter(e => e.curveInverted != null);

  const scatter = {
    // depth vs each macro parameter (Pearson r), plotted as points too
    fedFundsVsDepth: EPISODES.filter(e => e.fedFunds != null)
      .map(e => ({ x: e.fedFunds, y: Math.abs(e.drawdownPct), name: e.name, id: e.id })),
    cpiVsDepth: EPISODES.filter(e => e.cpiYoY != null)
      .map(e => ({ x: e.cpiYoY, y: Math.abs(e.drawdownPct), name: e.name, id: e.id })),
    tenYearVsDepth: EPISODES.filter(e => e.tenYear != null)
      .map(e => ({ x: e.tenYear, y: Math.abs(e.drawdownPct), name: e.name, id: e.id })),
  };

  return {
    count: EPISODES.length,
    avgDrawdown: avg(EPISODES.map(e => e.drawdownPct)),
    medianDrawdown: (() => {
      const s = EPISODES.map(e => e.drawdownPct).sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    })(),
    avgFedFunds: avg(withFunds.map(e => e.fedFunds)),
    avgCpi: avg(EPISODES.map(e => e.cpiYoY)),
    avgUnemployment: avg(EPISODES.map(e => e.unemployment)),

    // Frequency of classic pre-crash conditions
    pctHiking: EPISODES.filter(e => e.rateRegime === 'hiking').length / EPISODES.length,
    pctInverted: invKnown.length ? invKnown.filter(e => e.curveInverted).length / invKnown.length : null,
    pctRecession: EPISODES.filter(e => e.recessionFollowed).length / EPISODES.length,
    pctElevatedCpi: EPISODES.filter(e => e.cpiYoY != null && e.cpiYoY >= 4).length / EPISODES.length,

    // Correlations (small n — descriptive only)
    corr: {
      fedFundsVsDepth: pearson(scatter.fedFundsVsDepth.map(p => [p.x, p.y])),
      cpiVsDepth: pearson(scatter.cpiVsDepth.map(p => [p.x, p.y])),
      tenYearVsDepth: pearson(scatter.tenYearVsDepth.map(p => [p.x, p.y])),
    },
    scatter,
  };
}

// ── Present-day condition checklist ─────────────────────────────────────────
// Given a current macro snapshot, score how many classic pre-crash conditions
// are currently present. Educational, not predictive.
function scoreConditions(cur) {
  if (!cur) return null;
  const checks = [
    {
      key: 'hiking', label: 'Policy rate elevated / restrictive',
      present: cur.fedFunds != null ? cur.fedFunds >= 4 : null,
      detail: cur.fedFunds != null ? `Fed funds ${cur.fedFunds.toFixed(2)}%` : 'no data',
    },
    {
      key: 'inverted', label: 'Yield curve inverted (10y–2y < 0)',
      present: cur.curve != null ? cur.curve < 0 : null,
      detail: cur.curve != null ? `10y–2y ${cur.curve.toFixed(2)}%` : 'no data',
    },
    {
      key: 'cpi', label: 'Inflation elevated (CPI > 4%)',
      present: cur.cpiYoY != null ? cur.cpiYoY > 4 : null,
      detail: cur.cpiYoY != null ? `CPI ${cur.cpiYoY.toFixed(1)}% YoY` : 'no data',
    },
    {
      key: 'spread', label: 'Credit spreads stressed (HY OAS > 5%)',
      present: cur.hySpread != null ? cur.hySpread > 5 : null,
      detail: cur.hySpread != null ? `HY OAS ${cur.hySpread.toFixed(2)}%` : 'no data',
    },
    {
      key: 'unemp', label: 'Unemployment rising off its lows',
      present: cur.unempRising != null ? cur.unempRising : null,
      detail: cur.unemployment != null ? `Unemployment ${cur.unemployment.toFixed(1)}%` : 'no data',
    },
  ];
  const known = checks.filter(c => c.present != null);
  const flags = known.filter(c => c.present).length;
  return { checks, flags, scored: known.length };
}

module.exports = { EPISODES, computeSummary, scoreConditions, pearson };
