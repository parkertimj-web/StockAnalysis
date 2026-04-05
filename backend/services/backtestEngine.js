'use strict';

const { calculateSMAArray, calculateRSI, calculateMACD, calculateATR } = require('./indicators');

/**
 * Simple backtest: enter when RSI < oversold, exit when RSI > overbought or hits target/stop.
 */
function runBacktest(candles, config = {}) {
  const {
    rsiOversold = 40,
    rsiOverbought = 65,
    rsiPeriod = 14,
    smaPeriod = 50,
    requireAboveSMA = true,
    atrMultiplierStop = 2,
    atrMultiplierTarget = 4,
    startIndex = 50,
  } = config;

  const closes = candles.map(c => c.close);
  const smaArr = calculateSMAArray(closes, smaPeriod);
  const atrPeriod = 14;

  const trades = [];
  let inTrade = false;
  let entryPrice = 0;
  let stopPrice = 0;
  let targetPrice = 0;
  let entryDate = null;
  let entryIndex = 0;

  for (let i = startIndex; i < candles.length; i++) {
    const rsi = calculateRSI(closes.slice(0, i + 1), rsiPeriod);
    if (rsi === null) continue;

    const sma = smaArr[i];
    const atr = calculateATR(candles.slice(0, i + 1), atrPeriod);
    if (!atr) continue;

    if (!inTrade) {
      const aboveSMA = !requireAboveSMA || (sma !== null && closes[i] > sma);
      if (rsi < rsiOversold && aboveSMA) {
        inTrade = true;
        entryPrice = candles[i].close;
        entryDate = candles[i].time;
        entryIndex = i;
        stopPrice = entryPrice - atrMultiplierStop * atr;
        targetPrice = entryPrice + atrMultiplierTarget * atr;
      }
    } else {
      const { low, high, close, time } = candles[i];
      let exitPrice = null;
      let exitReason = null;

      if (low <= stopPrice) {
        exitPrice = stopPrice;
        exitReason = 'stop';
      } else if (high >= targetPrice) {
        exitPrice = targetPrice;
        exitReason = 'target';
      } else if (rsi > rsiOverbought) {
        exitPrice = close;
        exitReason = 'rsi_exit';
      } else if (i === candles.length - 1) {
        exitPrice = close;
        exitReason = 'end';
      }

      if (exitPrice !== null) {
        const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
        trades.push({
          entryDate,
          exitDate: time,
          entryPrice,
          exitPrice,
          stopPrice,
          targetPrice,
          pnlPct,
          exitReason,
          bars: i - entryIndex,
        });
        inTrade = false;
      }
    }
  }

  if (!trades.length) return { trades: [], stats: null };

  const winners = trades.filter(t => t.pnlPct > 0);
  const losers = trades.filter(t => t.pnlPct <= 0);
  const totalPnl = trades.reduce((a, t) => a + t.pnlPct, 0);
  const avgWin = winners.length ? winners.reduce((a, t) => a + t.pnlPct, 0) / winners.length : 0;
  const avgLoss = losers.length ? losers.reduce((a, t) => a + t.pnlPct, 0) / losers.length : 0;
  const expectancy = (winners.length / trades.length) * avgWin + (losers.length / trades.length) * avgLoss;

  const stats = {
    totalTrades: trades.length,
    winners: winners.length,
    losers: losers.length,
    winRate: (winners.length / trades.length) * 100,
    totalPnlPct: totalPnl,
    avgWinPct: avgWin,
    avgLossPct: avgLoss,
    expectancyPct: expectancy,
    largestWin: Math.max(...trades.map(t => t.pnlPct)),
    largestLoss: Math.min(...trades.map(t => t.pnlPct)),
    avgBars: trades.reduce((a, t) => a + t.bars, 0) / trades.length,
  };

  return { trades, stats };
}

module.exports = { runBacktest };
