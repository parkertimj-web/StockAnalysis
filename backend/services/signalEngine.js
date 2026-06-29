'use strict';

const {
  calculateSMAArray,
  calculateEMAArray,
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateADXSeries,
  calculateOBVSeries,
  calculateBollingerBands,
  calculateStochastic,
  calculateAvgVolume,
  calculateVWAP,
  calculateCCI,
  calculateMFI,
  calculateROC,
  findSwingLows,
  findSwingHighs,
} = require('./indicators');

const CORE_MAX = 6;
const TIER1_MAX = CORE_MAX + 5;
const TIER2_MAX = TIER1_MAX + 5;
const ADX_MAX = TIER2_MAX + 1;
const OBV_MAX = ADX_MAX + 1;
const REGIME_MAX = OBV_MAX + 1;

function scoreSignal(score, max) {
  const pct = score / max;
  if (pct >= 0.6) return 'strong_buy';
  if (pct >= 0.3) return 'buy';
  if (pct <= -0.6) return 'strong_sell';
  if (pct <= -0.3) return 'sell';
  return 'neutral';
}

// RSI mean-reversion state — mirrors the Backtest page's strategy:
// buy an oversold dip while the longer trend is still up, take profit
// once momentum swings back to overbought.
//   entry      → RSI < oversold AND price above SMA50 (dip in an uptrend)
//   oversold   → RSI < oversold but price below SMA50 (oversold, no trend support)
//   overbought → RSI > overbought (mean reversion complete → take profit)
//   neutral    → otherwise
function meanReversionState(rsi, price, sma50, oversold = 40, overbought = 65) {
  if (rsi == null) return { state: 'neutral', label: 'N/A', aboveSma50: null };
  const aboveSma50 = sma50 != null ? price > sma50 : null;
  if (rsi < oversold) {
    return aboveSma50
      ? { state: 'entry',    label: 'Buy Setup', aboveSma50 }
      : { state: 'oversold', label: 'Oversold',  aboveSma50 };
  }
  if (rsi > overbought) return { state: 'overbought', label: 'Take Profit', aboveSma50 };
  return { state: 'neutral', label: 'Neutral', aboveSma50 };
}

function analyseCandles(symbol, candles, spyCandles = null) {
  if (!candles || candles.length < 50) return null;

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];

  // MAs
  const sma20Arr = calculateSMAArray(closes, 20);
  const sma50Arr = calculateSMAArray(closes, 50);
  const sma200Arr = calculateSMAArray(closes, 200);

  const sma20 = sma20Arr[sma20Arr.length - 1];
  const sma50 = sma50Arr[sma50Arr.length - 1];
  const sma200 = sma200Arr[sma200Arr.length - 1];

  // RSI
  const rsi = calculateRSI(closes, 14);

  // MACD
  const macd = calculateMACD(closes);

  // ATR
  const atr = calculateATR(candles, 14);

  // ADX
  const adxArr = calculateADXSeries(candles, 14);
  const adxData = adxArr[adxArr.length - 1];
  const adx = adxData?.adx ?? 0;
  const diPlus = adxData?.diPlus ?? 0;
  const diMinus = adxData?.diMinus ?? 0;

  // OBV
  const obvArr = calculateOBVSeries(candles);
  const obvLen = obvArr.length;
  let obvSig = 0;
  if (obvLen >= 10) {
    const obvNow = obvArr[obvLen - 1].value;
    const obv10 = obvArr[obvLen - 10].value;
    const priceNow = price;
    const price10 = closes[closes.length - 10];
    // OBV divergence: OBV rising but price falling = bullish divergence
    const obvTrend = obvNow > obv10 ? 1 : obvNow < obv10 ? -1 : 0;
    const priceTrend = priceNow > price10 ? 1 : priceNow < price10 ? -1 : 0;
    if (obvTrend === 1) obvSig = 1;
    else if (obvTrend === -1) obvSig = -1;
    // bullish divergence
    if (obvTrend === 1 && priceTrend === -1) obvSig = 1;
  }

  // EMA 9/21 (short-term trend)
  const ema9Arr = calculateEMAArray(closes, 9);
  const ema21Arr = calculateEMAArray(closes, 21);
  const ema9 = ema9Arr[ema9Arr.length - 1];
  const ema21 = ema21Arr[ema21Arr.length - 1];

  // Bollinger %B
  const bb = calculateBollingerBands(closes, 20, 2);
  const percentB = bb && bb.upper !== bb.lower
    ? (price - bb.lower) / (bb.upper - bb.lower)
    : null;

  // Stochastic
  const stoch = calculateStochastic(candles, 14, 3);

  // Relative volume vs 20-day average
  const avgVol20 = calculateAvgVolume(candles, 20);
  const lastVol = candles[candles.length - 1].volume || 0;
  const rvol = avgVol20 > 0 ? lastVol / avgVol20 : null;
  const priceChange = closes.length >= 2
    ? closes[closes.length - 1] - closes[closes.length - 2]
    : 0;

  // 52W High/Low
  const lookback = Math.min(252, candles.length);
  const recentCandles = candles.slice(-lookback);
  const year52High = Math.max(...recentCandles.map(c => c.high));
  const year52Low = Math.min(...recentCandles.map(c => c.low));
  const range52Pct = year52High > year52Low
    ? (price - year52Low) / (year52High - year52Low)
    : null;

  // SPY regime
  let spyRegime = 'neutral';
  if (spyCandles && spyCandles.length >= 200) {
    const spyCloses = spyCandles.map(c => c.close);
    const spySMA200 = calculateSMAArray(spyCloses, 200);
    const spySMA = spySMA200[spySMA200.length - 1];
    const spyPrice = spyCloses[spyCloses.length - 1];
    spyRegime = spyPrice > spySMA ? 'bull' : 'bear';
  }

  // ── Component signals (each: +1, 0, -1)
  const rsiSig = rsi !== null
    ? (rsi < 40 ? 1 : rsi > 65 ? -1 : 0)
    : 0;

  const macdDirSig = macd
    ? (macd.bullish ? 1 : -1)
    : 0;

  const macdMomSig = macd
    ? (macd.histogramGrowing ? (macd.bullish ? 1 : -1) : 0)
    : 0;

  const vsSma20Sig = sma20 !== null
    ? (price > sma20 ? 1 : -1)
    : 0;

  const vsSma50Sig = sma50 !== null
    ? (price > sma50 ? 1 : -1)
    : 0;

  const smaTrendSig = sma50 !== null && sma200 !== null
    ? (sma50 > sma200 ? 1 : -1)
    : 0;

  const adxSig = adx >= 20
    ? (diPlus > diMinus ? 1 : -1)
    : 0; // suppress in chop

  const regimeSig = spyRegime === 'bull' ? 1 : spyRegime === 'bear' ? -1 : 0;

  // Tier 1 component signals
  const bbSig = percentB !== null
    ? (percentB < 0.2 ? 1 : percentB > 0.8 ? -1 : 0)
    : 0;

  const range52Sig = range52Pct !== null
    ? (range52Pct < 0.15 ? 1 : range52Pct > 0.85 ? -1 : 0)
    : 0;

  const rvolSig = rvol !== null && rvol >= 1.5
    ? (priceChange > 0 ? 1 : priceChange < 0 ? -1 : 0)
    : 0;

  const emaTrendSig = ema9 !== null && ema21 !== null
    ? (ema9 > ema21 ? 1 : -1)
    : 0;

  const stochSig = stoch
    ? (stoch.k < 20 ? 1 : stoch.k > 80 ? -1 : 0)
    : 0;

  // Tier 2 component signals
  const vwap = calculateVWAP(candles.slice(-60));
  const cci = calculateCCI(candles, 20);
  const mfi = calculateMFI(candles, 14);
  const roc = calculateROC(closes, 10);

  const vwapSig = vwap !== null
    ? (price > vwap ? 1 : price < vwap ? -1 : 0)
    : 0;

  const macdCrossSig = macd
    ? (macd.crossover ? 1 : macd.crossunder ? -1 : 0)
    : 0;

  const cciSig = cci !== null
    ? (cci < -100 ? 1 : cci > 100 ? -1 : 0)
    : 0;

  const mfiSig = mfi !== null
    ? (mfi < 20 ? 1 : mfi > 80 ? -1 : 0)
    : 0;

  const rocSig = roc !== null
    ? (roc > 2 ? 1 : roc < -2 ? -1 : 0)
    : 0;

  const components = {
    rsiSig, macdDirSig, macdMomSig,
    vsSma20Sig, vsSma50Sig, smaTrendSig,
    bbSig, range52Sig, rvolSig, emaTrendSig, stochSig,
    vwapSig, macdCrossSig, cciSig, mfiSig, rocSig,
    adxSig, obvSig, regimeSig,
  };

  // Progressive scoring: core → tier1 → tier2 → adx → obv → regime
  const core = rsiSig + macdDirSig + macdMomSig + vsSma20Sig + vsSma50Sig + smaTrendSig;
  const tier1 = core + bbSig + range52Sig + rvolSig + emaTrendSig + stochSig;
  const tier2 = tier1 + vwapSig + macdCrossSig + cciSig + mfiSig + rocSig;
  const adxScore = tier2 + adxSig;
  const obvScore = adxScore + obvSig;
  const regimeScore = obvScore + regimeSig;

  const scores = {
    core:   { score: core,        max: CORE_MAX,   signal: scoreSignal(core, CORE_MAX) },
    tier1:  { score: tier1,       max: TIER1_MAX,  signal: scoreSignal(tier1, TIER1_MAX) },
    tier2:  { score: tier2,       max: TIER2_MAX,  signal: scoreSignal(tier2, TIER2_MAX) },
    adx:    { score: adxScore,    max: ADX_MAX,    signal: scoreSignal(adxScore, ADX_MAX) },
    obv:    { score: obvScore,    max: OBV_MAX,    signal: scoreSignal(obvScore, OBV_MAX) },
    regime: { score: regimeScore, max: REGIME_MAX, signal: scoreSignal(regimeScore, REGIME_MAX) },
  };

  // Buy/Sell zones
  let buyZone = null;
  let sellZone = null;

  const masBelowPrice = [];
  const masAbovePrice = [];
  if (sma20 !== null) {
    if (sma20 < price) masBelowPrice.push({ price: sma20, label: 'SMA 20' });
    else masAbovePrice.push({ price: sma20, label: 'SMA 20' });
  }
  if (sma50 !== null) {
    if (sma50 < price) masBelowPrice.push({ price: sma50, label: 'SMA 50' });
    else masAbovePrice.push({ price: sma50, label: 'SMA 50' });
  }
  if (sma200 !== null) {
    if (sma200 < price) masBelowPrice.push({ price: sma200, label: 'SMA 200' });
    else masAbovePrice.push({ price: sma200, label: 'SMA 200' });
  }

  // Closest MA below → buy zone
  if (masBelowPrice.length > 0) {
    const closest = masBelowPrice.reduce((a, b) => (b.price > a.price ? b : a));
    buyZone = { ...closest, distPct: ((price - closest.price) / price) * -100 };
  }

  // Closest MA above → sell zone; else 52W high
  if (masAbovePrice.length > 0) {
    const closest = masAbovePrice.reduce((a, b) => (b.price < a.price ? b : a));
    sellZone = { ...closest, distPct: ((closest.price - price) / price) * 100 };
  } else {
    sellZone = { price: year52High, label: '52W High', distPct: ((year52High - price) / price) * 100 };
  }

  // Swing fallback
  if (!buyZone) {
    const swingLows = findSwingLows(candles.slice(-504), 5); // ~2yr
    const below = swingLows.filter(s => s.price < price);
    if (below.length > 0) {
      const nearest = below.reduce((a, b) => (b.price > a.price ? b : a));
      buyZone = { price: nearest.price, label: 'Swing Low', distPct: ((price - nearest.price) / price) * -100 };
    }
  }
  if (!buyZone) buyZone = { price: year52Low, label: '52W Low', distPct: ((price - year52Low) / price) * -100 };

  // Stop loss & R:R
  const stopLoss = atr ? buyZone.price - 1.5 * atr : buyZone.price * 0.97;
  const rr = stopLoss < price
    ? (sellZone.price - price) / (price - stopLoss)
    : null;

  return {
    symbol,
    price,
    sma20, sma50, sma200,
    ema9, ema21,
    rsi,
    meanReversion: { ...meanReversionState(rsi, price, sma50), rsi },
    percentB,
    range52Pct,
    rvol,
    stochK: stoch?.k ?? null,
    stochD: stoch?.d ?? null,
    vwap,
    cci,
    mfi,
    roc,
    adx, diPlus, diMinus,
    year52High, year52Low,
    buyZone,
    sellZone,
    stopLoss,
    rr,
    spyRegime,
    scores,
    components,
  };
}

module.exports = { analyseCandles, scoreSignal };
