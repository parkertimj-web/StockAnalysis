'use strict';

function calculateSMA(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateEMAArray(closes, period) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period) return result;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

function calculateSMAArray(closes, period) {
  const result = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    result[i] = slice.reduce((a, b) => a + b, 0) / period;
  }
  return result;
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
  if (closes.length < slow + signal) return null;
  const fastArr = calculateEMAArray(closes, fast);
  const slowArr = calculateEMAArray(closes, slow);

  const macdLine = fastArr.map((f, i) =>
    f !== null && slowArr[i] !== null ? f - slowArr[i] : null
  );

  // EMA of MACD line for signal
  const validStart = macdLine.findIndex(v => v !== null);
  if (validStart < 0) return null;
  const macdValues = macdLine.slice(validStart);

  const k = 2 / (signal + 1);
  if (macdValues.length < signal) return null;
  let sig = macdValues.slice(0, signal).reduce((a, b) => a + b, 0) / signal;
  let prevSig = sig;
  let prevMacd = macdValues[signal - 1];

  for (let i = signal; i < macdValues.length; i++) {
    prevMacd = macdValues[i - 1];
    prevSig = sig;
    sig = macdValues[i] * k + sig * (1 - k);
  }

  const macd = macdLine[macdLine.length - 1];
  const histogram = macd !== null ? macd - sig : null;
  const prevHistogram = prevMacd - prevSig;

  return {
    macd,
    signal: sig,
    histogram,
    bullish: macd > sig,
    crossover: prevMacd <= prevSig && macd > sig,
    crossunder: prevMacd >= prevSig && macd < sig,
    histogramGrowing: histogram !== null && prevHistogram !== null
      ? (macd > sig ? histogram > prevHistogram : histogram < prevHistogram)
      : false,
  };
}

function calculateVWAP(candles) {
  if (!candles.length) return null;
  let cumTPV = 0, cumVol = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * (c.volume || 0);
    cumVol += c.volume || 0;
  }
  return cumVol > 0 ? cumTPV / cumVol : null;
}

function calculateVWAPArray(candles) {
  const result = new Array(candles.length).fill(null);
  let cumTPV = 0, cumVol = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const tp = (c.high + c.low + c.close) / 3;
    cumTPV += tp * (c.volume || 0);
    cumVol += c.volume || 0;
    result[i] = cumVol > 0 ? cumTPV / cumVol : null;
  }
  return result;
}

function calculateBollingerBands(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const sd = Math.sqrt(variance);
  return {
    upper: mean + stdDev * sd,
    middle: mean,
    lower: mean - stdDev * sd,
    bandwidth: (2 * stdDev * sd) / mean,
  };
}

function calculateBollingerBandsArray(closes, period = 20, stdDev = 2) {
  const result = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const sd = Math.sqrt(variance);
    result[i] = {
      upper: mean + stdDev * sd,
      middle: mean,
      lower: mean - stdDev * sd,
    };
  }
  return result;
}

function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high, low = candles[i].low, prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (trs.length < period) return null;
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function calculateADXSeries(candles, period = 14) {
  const result = new Array(candles.length).fill(null);
  if (candles.length < period * 2) return result;

  const trs = [], plusDMs = [], minusDMs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low;
    const ph = candles[i - 1].high, pl = candles[i - 1].low, pc = candles[i - 1].close;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    const upMove = h - ph;
    const downMove = pl - l;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(tr);
  }

  // Wilder smoothing
  let smoothTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPlus = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinus = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

  const adxValues = [];
  let adx = null;
  let dxHistory = [];

  function compute(idx) {
    const diPlus = smoothTR > 0 ? (smoothPlus / smoothTR) * 100 : 0;
    const diMinus = smoothTR > 0 ? (smoothMinus / smoothTR) * 100 : 0;
    const dxDenom = diPlus + diMinus;
    const dx = dxDenom > 0 ? (Math.abs(diPlus - diMinus) / dxDenom) * 100 : 0;
    return { diPlus, diMinus, dx };
  }

  for (let i = period; i < trs.length; i++) {
    smoothTR = smoothTR - smoothTR / period + trs[i];
    smoothPlus = smoothPlus - smoothPlus / period + plusDMs[i];
    smoothMinus = smoothMinus - smoothMinus / period + minusDMs[i];
    const { diPlus, diMinus, dx } = compute(i);
    dxHistory.push({ diPlus, diMinus, dx });

    if (dxHistory.length === period) {
      adx = dxHistory.reduce((a, b) => a + b.dx, 0) / period;
    } else if (dxHistory.length > period) {
      adx = (adx * (period - 1) + dx) / period;
    }

    if (adx !== null) {
      const candleIdx = i + 1; // offset: trs starts at candle[1]
      if (candleIdx < result.length) {
        result[candleIdx] = { adx, diPlus, diMinus };
      }
    }
  }

  return result;
}

function calculateOBVSeries(candles) {
  if (!candles.length) return [];
  const result = [];
  let obv = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      result.push({ time: candles[i].time, value: 0 });
      continue;
    }
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) obv += candles[i].volume || 0;
    else if (diff < 0) obv -= candles[i].volume || 0;
    result.push({ time: candles[i].time, value: obv });
  }
  return result;
}

function findSwingLows(candles, lookback = 5) {
  const swings = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const low = candles[i].low;
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && candles[j].low <= low) { isSwing = false; break; }
    }
    if (isSwing) swings.push({ time: candles[i].time, price: low });
  }
  return swings;
}

function findSwingHighs(candles, lookback = 5) {
  const swings = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const high = candles[i].high;
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && candles[j].high >= high) { isSwing = false; break; }
    }
    if (isSwing) swings.push({ time: candles[i].time, price: high });
  }
  return swings;
}

module.exports = {
  calculateSMA,
  calculateSMAArray,
  calculateEMA,
  calculateEMAArray,
  calculateRSI,
  calculateMACD,
  calculateVWAP,
  calculateVWAPArray,
  calculateBollingerBands,
  calculateBollingerBandsArray,
  calculateATR,
  calculateADXSeries,
  calculateOBVSeries,
  findSwingLows,
  findSwingHighs,
};
