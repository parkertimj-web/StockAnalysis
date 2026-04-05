'use strict';

const Anthropic = require('@anthropic-ai/sdk');

let client = null;
function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

async function summariseSignal(signalData) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return 'AI summary unavailable — set ANTHROPIC_API_KEY in backend/.env';
  }

  const prompt = `You are a stock analysis assistant. Given this technical analysis data for ${signalData.symbol}, provide a concise 2-3 sentence trading summary for a position trader. Focus on the key signals and what they suggest for the next 2-8 weeks. Be direct and specific.

Data:
- Price: $${signalData.price?.toFixed(2)}
- RSI(14): ${signalData.rsi?.toFixed(1)}
- ADX: ${signalData.adx?.toFixed(1)} (DI+: ${signalData.diPlus?.toFixed(1)}, DI-: ${signalData.diMinus?.toFixed(1)})
- SMA 20: $${signalData.sma20?.toFixed(2)}, SMA 50: $${signalData.sma50?.toFixed(2)}, SMA 200: $${signalData.sma200?.toFixed(2)}
- Buy zone: ${signalData.buyZone?.label} at $${signalData.buyZone?.price?.toFixed(2)}
- Target: ${signalData.sellZone?.label} at $${signalData.sellZone?.price?.toFixed(2)}
- Stop loss: $${signalData.stopLoss?.toFixed(2)}
- R:R ratio: ${signalData.rr?.toFixed(2)}
- Signal scores: Base ${signalData.scores?.base?.score}/${signalData.scores?.base?.max} (${signalData.scores?.base?.signal}), Regime ${signalData.scores?.regime?.score}/${signalData.scores?.regime?.max} (${signalData.scores?.regime?.signal})
- SPY regime: ${signalData.spyRegime}`;

  const msg = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  return msg.content[0]?.text || 'No summary generated.';
}

async function analyseJournalTrade(trade) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return 'AI analysis unavailable — set ANTHROPIC_API_KEY in backend/.env';
  }

  const prompt = `Analyse this trade from a position trading perspective and provide a brief lesson or insight (2-3 sentences):

Symbol: ${trade.symbol}
Direction: ${trade.direction}
Entry: $${trade.entry_price} on ${trade.entry_date}
${trade.exit_price ? `Exit: $${trade.exit_price} on ${trade.exit_date}` : 'Status: Open'}
${trade.pnl !== undefined ? `P&L: $${trade.pnl?.toFixed(2)}` : ''}
${trade.stop_loss ? `Stop loss: $${trade.stop_loss}` : ''}
${trade.target_price ? `Target: $${trade.target_price}` : ''}
${trade.notes ? `Notes: ${trade.notes}` : ''}`;

  const msg = await getClient().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });

  return msg.content[0]?.text || 'No analysis generated.';
}

module.exports = { summariseSignal, analyseJournalTrade };
