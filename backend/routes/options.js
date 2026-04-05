'use strict';

const express = require('express');
const router  = express.Router();
const { getOptions } = require('../services/yahooFinance');

// GET /api/options/:symbol?date=unixSeconds
router.get('/:symbol', async (req, res) => {
  const symbol   = req.params.symbol.toUpperCase();
  const dateUnix = req.query.date ? parseInt(req.query.date) : undefined;

  try {
    const data = await getOptions(symbol, dateUnix);
    if (!data) return res.status(404).json({ error: 'No options data available' });

    const optionChain = data.options?.[0] || {};

    // expirationDates already in ms from CBOE service — pass straight through
    res.json({
      symbol,
      underlyingPrice:  data.quote?.regularMarketPrice ?? null,
      expirationDates:  data.expirationDates || [],
      calls: optionChain.calls || [],
      puts:  optionChain.puts  || [],
    });
  } catch (e) {
    console.error('[options route]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
