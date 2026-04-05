'use strict';

const {
  calculateSMAArray,
  calculateEMAArray,
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateADXSeries,
  calculateOBVSeries,
  findSwingLows,
  findSwingHighs,
} = require('./indicators');

function scoreSignal(score, max) {
  const pct = score / max;
  if (pct >= 0.6) return 'strong_buy';
  if (pct >= 0.3) return 'buy';
  if (pct <= -0.6) return 'strong_sell';
  if (pct <= -0.3) return 'sell';
  return 'neutral';
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

  // 52W High/Low
  const lookback = Math.min(252, candles.length);
  const recentCandles = candles.slice(-lookback);
  const year52High = Math.max(...recentCandles.map(c => c.high));
  const year52Low = Math.min(...recentCandles.map(c => c.low));

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

  const components = {
    rsiSig, macdDirSig, macdMomSig,
    vsSma20Sig, vsSma50Sig, smaTrendSig,
    adxSig, obvSig, regimeSig,
  };

  // Progressive scoring
  const base = rsiSig + macdDirSig + macdMomSig + vsSma20Sig + vsSma50Sig + smaTrendSig;
  const adxScore = base + adxSig;
  const obvScore = adxScore + obvSig;
  const regimeScore = obvScore + regimeSig;

  const scores = {
    base:   { score: base,        max: 6, signal: scoreSignal(base, 6) },
    adx:    { score: adxScore,    max: 7, signal: scoreSignal(adxScore, 7) },
    obv:    { score: obvScore,    max: 8, signal: scoreSignal(obvScore, 8) },
    regime: { score: regimeScore, max: 9, signal: scoreSignal(regimeScore, 9) },
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
    rsi,
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
