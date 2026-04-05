'use strict';

const axios = require('axios');

const BASE = 'https://www.alphavantage.co/query';

async function getDailyAdjusted(symbol) {
  if (!process.env.ALPHA_VANTAGE_API_KEY) {
    throw new Error('ALPHA_VANTAGE_API_KEY not set');
  }
  const res = await axios.get(BASE, {
    params: {
      function: 'TIME_SERIES_DAILY_ADJUSTED',
      symbol,
      outputsize: 'full',
      apikey: process.env.ALPHA_VANTAGE_API_KEY,
    },
    timeout: 20000,
  });

  const series = res.data?.['Time Series (Daily)'];
  if (!series) throw new Error('No data from Alpha Vantage');

  return Object.entries(series)
    .map(([date, vals]) => ({
      time: Math.floor(new Date(date).getTime() / 1000),
      open: parseFloat(vals['1. open']),
      high: parseFloat(vals['2. high']),
      low: parseFloat(vals['3. low']),
      close: parseFloat(vals['5. adjusted close']),
      volume: parseInt(vals['6. volume']),
    }))
    .sort((a, b) => a.time - b.time);
}

module.exports = { getDailyAdjusted };
