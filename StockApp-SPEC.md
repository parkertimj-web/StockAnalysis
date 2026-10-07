# StockAnalysis — Software Specification

**Version:** 1.0 (describes the system as built, October 2026)
**Audience:** an engineer rebuilding the application from scratch, with no access to the original source.

This document specifies *what* the system does and the exact rules it applies (indicator math, scoring thresholds, caching policy, data contracts). Where the original made an implementation choice that matters for behaviour (a threshold, a TTL, a fallback order), it is stated as a requirement. Where it doesn't matter (variable names, file layout), it is left to the implementer.

---

## Contents

1. [Product overview](#1-product-overview)
2. [Architecture](#2-architecture)
3. [External data sources](#3-external-data-sources)
4. [Caching and rate-limit policy](#4-caching-and-rate-limit-policy)
5. [Data model](#5-data-model)
6. [Technical indicators](#6-technical-indicators)
7. [Signal engine](#7-signal-engine)
8. [Backtest engine](#8-backtest-engine)
9. [Fundamentals (SEC EDGAR)](#9-fundamentals-sec-edgar)
10. [Macro modules](#10-macro-modules)
11. [Alerts](#11-alerts)
12. [Backend HTTP API](#12-backend-http-api)
13. [Frontend](#13-frontend)
14. [Configuration](#14-configuration)
15. [Build, run, deploy](#15-build-run-deploy)
16. [Non-functional requirements](#16-non-functional-requirements)
17. [Known limitations and out of scope](#17-known-limitations-and-out-of-scope)

---

## 1. Product overview

StockAnalysis is a **single-user, self-hosted stock analysis workstation** for a position trader (holding periods of roughly 2–8 weeks). It combines:

- **Technical analysis** — interactive price charts with overlays and sub-panels; a multi-tier buy/sell scoring engine applied to a personal watchlist.
- **Options** — options chains and a multi-expiry "calls matrix".
- **Fundamentals** — valuation ratios and 12-month (trailing-twelve-month, TTM) trend charts computed from official SEC filings.
- **Strategy testing** — a backtester for an RSI mean-reversion strategy.
- **Trade management** — price alerts (in-app, email, web-push) and a trade journal with P&L statistics.
- **Macro research** — historical market crashes vs. interest-rate backdrop; Japan/US-Treasury sell-off risk; China de-dollarization tracking, each with live FX and news.

It is designed to run **without any paid data subscription**. Only one free API key (TwelveData) is required for price history; every other source is keyless or optional.

### 1.1 Users

One user. All user-owned rows use `user_id = 1`. There is no authentication. The app is intended to run on `localhost` or a private host.

### 1.2 Disclaimer requirement

Every analytical page (signals, macro, Japan, China, crash history) must state that its content is **educational and not investment advice**. Curated figures must be labelled as approximate.

---

## 2. Architecture

```
┌──────────────────────────┐   /api/*  (Vite proxy in dev)   ┌───────────────────────────┐
│  Frontend SPA            │ ───────────────────────────────▶ │  Backend API              │
│  React 18 + Vite         │                                  │  Node.js ≥ 22 + Express 4 │
│  Tailwind, Zustand       │ ◀─────────── JSON / SSE ──────── │  node:sqlite (built-in)   │
│  lightweight-charts,     │                                  │  node-cron, axios         │
│  Recharts                │                                  └─────────────┬─────────────┘
└──────────────────────────┘                                                │ HTTPS
                                       ┌────────────────────────────────────┼──────────────────────────────┐
                                       ▼              ▼              ▼      ▼         ▼          ▼          ▼
                                  TwelveData      Yahoo/CBOE     CBOE    SEC EDGAR  Frankfurter Google News  FRED
                                  (history)       (live quotes)  (options)(fundamentals)(FX)    (RSS)       (optional)
```

| Concern | Requirement |
|---|---|
| Runtime | Node.js **22 or newer** (uses the built-in `node:sqlite` module, started with `--experimental-sqlite`). |
| Backend | Express 4 REST API on port **3001** (dev). JSON bodies. CORS restricted to the frontend origin in dev; disabled in production (same origin). |
| Database | A single SQLite file at `backend/data/stocks.db`, WAL mode. Schema in §5 is applied idempotently (`CREATE TABLE IF NOT EXISTS`) on every start. |
| Frontend | React 18 SPA built with Vite, served on port **5173** in dev; Vite proxies `/api` → `http://localhost:3001`. |
| Production | `NODE_ENV=production`: the backend serves the built SPA from `frontend/dist` and returns `index.html` for any non-API route (client-side routing fallback). Listens on `$PORT`. |
| Styling | Tailwind CSS, dark theme (gray-900/950 grounds, gray-100–400 text), monospace for numbers. |
| Platforms | macOS, Linux, Windows. |

### 2.1 Process robustness

- The backend must **not exit** on uncaught exceptions or unhandled promise rejections; it logs them and continues.
- In development only, on startup the backend kills any stale process holding its port (`lsof -ti:<port>`), and on `EADDRINUSE` retries once after clearing it. This step must be skipped in production and must fail silently where `lsof` is unavailable (e.g. Windows).
- In development, the generic `PORT` env var must be **ignored** for the API (tooling often exports `PORT=5173` for the frontend); use `API_PORT` or 3001. In production, honour `PORT`.

### 2.2 Frontend resilience

- Every routed page and every independently-rendered mini-chart is wrapped in an **error boundary**. A render error shows a small card with the error and a **Retry** button; it must never blank the whole app.
- Charting libraries throw on unsorted or duplicate timestamps. All candle arrays must be **sorted ascending and de-duplicated by timestamp** before reaching any chart (enforce on the backend at ingestion).

---

## 3. External data sources

| Purpose | Source | Auth | Notes |
|---|---|---|---|
| Daily/weekly/monthly OHLCV history | TwelveData `GET https://api.twelvedata.com/time_series` | **Free API key required** | Free tier: 8 requests/min, 800/day. Request `outputsize=1200`. Returns newest-first; reverse to oldest-first. |
| Live (delayed) quotes | Yahoo Finance `v8/finance/quote` (batch), falling back per-symbol to CBOE `cdn.cboe.com/api/global/delayed_quotes/quotes/{SYM}.json` | None | ~15-min delayed. CBOE provides `current_price, open, high, low, volume, prev_day_close, last_trade_time`. |
| Options chains | CBOE `cdn.cboe.com/api/global/delayed_quotes/options/{SYM}.json` | None | All expirations in one call. Contracts identified by OCC symbol (see §3.1). |
| Fundamentals | SEC EDGAR: `www.sec.gov/files/company_tickers.json` (ticker→CIK) and `data.sec.gov/api/xbrl/companyfacts/CIK##########.json` | None | Must send a descriptive `User-Agent` with a contact address (SEC policy). Pace requests ≥ 200 ms apart. |
| FX history (USD/JPY, USD/CNY) | Frankfurter `https://api.frankfurter.dev/v1/{start}..{end}?base=USD&symbols=JPY` | None | ECB daily reference rates, business days only. |
| News headlines | Google News RSS `https://news.google.com/rss/search?q=…&hl=en-US&gl=US&ceid=US:en` | None | XML; parse `<item>` blocks. |
| Macro series (optional) | FRED `api.stlouisfed.org/fred/series/observations` | Optional free key | Series used: `FEDFUNDS`, `T10Y2Y`, `CPIAUCSL`, `UNRATE`, `BAMLH0A0HYM2`. Missing values are reported as `"."` and must be skipped. |
| AI summaries (optional) | Anthropic Messages API | Optional key | Short trade summaries. |

### 3.1 OCC option symbol parsing

Format `ROOT YYMMDD C|P STRIKE×1000 (8 digits)`, e.g. `TSLA231215C00250000` → TSLA, 2023-12-15, Call, $250.00. Regex: `^([A-Z0-9]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$`. Expiration is midnight UTC of that date.

### 3.2 Source-failure behaviour

Every external call has a timeout (10–25 s). A failure of a non-critical source (live quote, fundamentals, news, FX, FRED) must degrade that one field or panel, never fail the whole response. Failures of a quote fall back to the most recent daily close.

---

## 4. Caching and rate-limit policy

Caching is essential: the free TwelveData tier would otherwise be exhausted in minutes.

### 4.1 Market-hours helper

"Market hours" = Monday–Friday, 09:30–16:00 US Eastern. (An approximate fixed UTC−4 offset is acceptable.) "Last market close" = the most recent weekday 16:00 ET.

### 4.2 Price history (TwelveData)

- **Two-level cache:** in-memory map plus the `history_cache` SQLite table (persists across restarts), keyed by `(symbol, interval)`, storing the full candle array as JSON and `fetched_at`.
- **Freshness rule:**
  - During market hours: fresh if fetched < **15 minutes** ago.
  - Outside market hours: fresh if fetched **after the last market close + 15 minutes** (settling grace). Data fetched after the close stays valid all night and weekend.
- **Throttle:** serialize TwelveData requests through a queue spaced **8 seconds** apart (free tier = 8/min).
- **In-flight de-duplication:** concurrent requests for the same `(symbol, interval)` share one network promise.
- **Stale-while-revalidate:** if a cached copy exists, return it immediately and refresh in the background; only block when there is no cached copy at all.
- Callers request a date range; filter the cached full series to `time >= from`.

### 4.3 Other TTLs

| Data | TTL |
|---|---|
| Live quote | 90 s during market hours; 15 min outside |
| Options chain (per symbol) | 10 min, with in-flight de-dup |
| Fundamentals (per symbol, SQLite `fundamentals_cache`) | 30 days (filings change quarterly); failed lookups cached 1 h |
| SEC ticker→CIK map | 24 h |
| TTM moving-average series | 6 h |
| FX series (Japan/China pages) | 6 h; only cache successful responses |
| News per topic | 30 min |
| FRED present-day snapshot | 6 h |

---

## 5. Data model

SQLite, applied on every startup. All timestamps are SQLite `DATETIME DEFAULT CURRENT_TIMESTAMP` unless noted.

```sql
users            (id INTEGER PK, username TEXT DEFAULT 'trader', created_at)
                 -- seed: INSERT OR IGNORE (1, 'trader')

watchlist        (id PK AUTOINCREMENT, user_id INT DEFAULT 1, symbol TEXT NOT NULL,
                  added_at, UNIQUE(user_id, symbol))

signal_config    (id PK, symbol TEXT UNIQUE, rsi_period INT DEFAULT 14,
                  rsi_oversold REAL DEFAULT 40, rsi_overbought REAL DEFAULT 65,
                  sma_periods TEXT DEFAULT '20,50,200', price_alert_low REAL,
                  price_alert_high REAL, updated_at)            -- reserved; not used by UI

price_cache      (id PK, symbol, timestamp INT, open, high, low, close, volume,
                  cached_at, UNIQUE(symbol, timestamp))         -- legacy; superseded by history_cache

signal_history   (id PK, symbol, price REAL, signal TEXT, score INT, max_score INT,
                  components TEXT /* JSON */, captured_at)      -- written by the cron job

alerts           (id PK, user_id INT DEFAULT 1, symbol TEXT, alert_type TEXT
                  /* 'price' | 'price_once' */, condition TEXT /* 'above'|'below' */,
                  value REAL, message TEXT, is_active INT DEFAULT 1, created_at)

alert_log        (id PK, alert_id INT FK alerts, symbol, message, price REAL, fired_at)

trade_journal    (id PK, user_id INT DEFAULT 1, symbol TEXT, trade_type TEXT DEFAULT 'stock',
                  direction TEXT DEFAULT 'long', entry_date TEXT, entry_price REAL,
                  quantity REAL, exit_date TEXT, exit_price REAL, stop_loss REAL,
                  target_price REAL, notes TEXT, tags TEXT, status TEXT DEFAULT 'open',
                  pnl REAL, created_at)

backtest_results (id PK, symbol, config TEXT /* JSON */, results TEXT /* JSON */, run_at)

push_subscriptions (id PK, endpoint TEXT UNIQUE, p256dh TEXT, auth TEXT, created_at)

history_cache    (symbol TEXT, interval TEXT, candles TEXT /* JSON array */,
                  fetched_at INT /* epoch ms */, PRIMARY KEY(symbol, interval))

fundamentals_cache (symbol TEXT PK, data TEXT /* JSON */, fetched_at, expires_at INT /* epoch ms */)
```

### 5.1 Candle shape

`{ time: <unix seconds>, open, high, low, close, volume }` — numbers; volume integer. Arrays are oldest-first, sorted, unique by `time`.

---

## 6. Technical indicators

All indicators operate on oldest-first candle arrays. "Series" functions return an array aligned to the input (null until warm). Scalar functions return the value for the latest bar or `null` if there is insufficient data. Indicator warm-up requires fetching **~280 extra calendar days** before the displayed period.

| Indicator | Definition |
|---|---|
| **SMA(n)** | Arithmetic mean of last *n* closes. Periods used: 20, 50, 200. |
| **EMA(n)** | Seed = SMA of first *n* closes; then `ema = close·k + ema·(1−k)`, `k = 2/(n+1)`. Periods: 9, 21. |
| **RSI(14)** | Wilder: seed avg gain/loss over first 14 changes, then `avg = (avg·13 + current)/14`. `RSI = 100 − 100/(1 + avgGain/avgLoss)`; 100 if avgLoss = 0. |
| **MACD(12,26,9)** | MACD line = EMA12 − EMA26; signal = EMA9 of MACD line; histogram = MACD − signal. Also report: `bullish` (MACD > signal), `crossover` (prev MACD ≤ prev signal and now MACD > signal), `crossunder` (mirror), `histogramGrowing` (in the bullish case histogram > previous histogram; in the bearish case histogram < previous). |
| **Bollinger(20, 2)** | Middle = SMA20; upper/lower = middle ± 2·population std-dev. **%B** = (price − lower)/(upper − lower). |
| **VWAP** | Σ(typical price × volume)/Σ volume, typical = (H+L+C)/3. For signals, computed over the **last 60 daily bars**; for the chart, cumulative over the displayed data. |
| **ATR(14)** | Wilder-smoothed true range; TR = max(H−L, |H−prevC|, |L−prevC|). |
| **ADX(14), DI+, DI−** | Standard Wilder DMI: +DM/−DM, smoothed TR/+DM/−DM, DI± = 100·smoothed DM / smoothed TR, DX = 100·|DI+−DI−|/(DI++DI−), ADX = Wilder average of DX (seeded by a 14-bar simple average). |
| **OBV** | Running total: +volume on an up close, −volume on a down close, unchanged on flat. |
| **Stochastic(14, 3)** | %K = 100·(close − lowest low₁₄)/(highest high₁₄ − lowest low₁₄) (50 if range = 0); %D = mean of last 3 %K. Only the last `k+d−1` bars need scanning. |
| **CCI(20)** | (TP − SMA(TP))/(0.015 · mean absolute deviation of TP); 0 if MAD = 0. |
| **MFI(14)** | Over the last 15 bars, classify each bar's money flow (TP × volume) as positive if TP > prior TP, negative if lower. `MFI = 100 − 100/(1 + pos/neg)`; 100 if neg = 0; null if there is no volume. |
| **ROC(10)** | 100·(close − close₁₀ bars ago)/close₁₀ bars ago. |
| **Relative volume** | last volume / 20-day average volume. |
| **Supertrend(10, 3)** | ATR (Wilder, 10). Basic bands = (H+L)/2 ± 3·ATR. Final upper band only moves down unless the prior close broke above it; final lower band only moves up unless the prior close broke below it. Trend flips to up when close > final upper, to down when close < final lower. Output per bar: `{ value, trend: 'up'|'down' }` where value is the lower band in an uptrend and the upper band in a downtrend. |
| **Swing lows/highs(5)** | A bar whose low (high) is strictly lower (higher) than the 5 bars on each side. |
| **52-week high/low** | Max high / min low over the last 252 bars. |

---

## 7. Signal engine

`analyse(symbol, candles, spyCandles)` returns a full signal object for a symbol; requires ≥ 50 candles, else `null`. Always fetch **1 year + 280 days** of daily candles. SPY is fetched once per request and used for the market regime.

### 7.1 Component votes

Each component votes **+1 (bullish), 0, or −1 (bearish)**. Thresholds are requirements:

| Tier | Component | +1 when | −1 when |
|---|---|---|---|
| Core | RSI(14) | < 40 | > 65 |
| Core | MACD direction | MACD > signal | otherwise |
| Core | MACD momentum | histogram growing in its current direction → +1 if bullish, −1 if bearish | (0 otherwise) |
| Core | Price vs SMA20 | above | below |
| Core | Price vs SMA50 | above | below |
| Core | SMA50 vs SMA200 | SMA50 > SMA200 | otherwise |
| Tier 1 | Bollinger %B | < 0.2 | > 0.8 |
| Tier 1 | 52-week range position | < 15% of range | > 85% of range |
| Tier 1 | Relative volume surge | RVOL ≥ 1.5 and today up | RVOL ≥ 1.5 and today down |
| Tier 1 | EMA9 vs EMA21 | EMA9 > EMA21 | otherwise |
| Tier 1 | Stochastic %K | < 20 | > 80 |
| Tier 2 | Price vs VWAP(60d) | above | below |
| Tier 2 | MACD crossover | fresh crossover | fresh crossunder |
| Tier 2 | CCI(20) | < −100 | > +100 |
| Tier 2 | MFI(14) | < 20 | > 80 |
| Tier 2 | ROC(10) | > +2% | < −2% |
| — | ADX / DI | ADX ≥ 20 and DI+ > DI− | ADX ≥ 20 and DI− ≥ DI+ (0 when ADX < 20 — suppressed in chop) |
| — | OBV | OBV higher than 10 bars ago | OBV lower than 10 bars ago |
| — | SPY regime | SPY close > SPY SMA200 ("bull") | below ("bear"); 0 if SPY unavailable ("neutral") |

A component with insufficient data votes 0.

### 7.2 Progressive scores

Scores accumulate; each has a max equal to its component count:

| Score | Formula | Max |
|---|---|---|
| `core` | sum of 6 core votes | 6 |
| `tier1` | core + 5 tier-1 votes | 11 |
| `tier2` | tier1 + 5 tier-2 votes | 16 |
| `adx` | tier2 + ADX vote | 17 |
| `obv` | adx + OBV vote | 18 |
| `regime` | obv + SPY regime vote | 19 |

Each score carries a label from `pct = score/max`: **≥ 0.6 `strong_buy`**, **≥ 0.3 `buy`**, **≤ −0.6 `strong_sell`**, **≤ −0.3 `sell`**, else `neutral`. The **headline signal is `regime`**.

### 7.3 Buy zone, target, stop, R:R

- **Buy zone:** the closest of {SMA20, SMA50, SMA200} *below* price. If none, the nearest swing low below price within the last ~2 years (504 bars). If still none, the 52-week low. Report `{ price, label, distPct }`.
- **Target (sell zone):** the closest of those MAs *above* price; else the 52-week high.
- **Stop loss:** `buyZone.price − 1.5 × ATR(14)`; if ATR is unavailable, `buyZone.price × 0.97`.
- **R:R:** `(target − price)/(price − stop)` when stop < price, else null. ≥ 2 is highlighted as favourable.

### 7.4 RSI mean-reversion marker

Mirrors the backtest strategy (§8) applied to today:

| State | Rule | Label | Colour |
|---|---|---|---|
| `entry` | RSI < 40 **and** price > SMA50 | Buy Setup | green |
| `oversold` | RSI < 40 and price ≤ SMA50 | Oversold | yellow |
| `overbought` | RSI > 65 | Take Profit | red |
| `neutral` | otherwise | Neutral | gray |

Also report **mean-reversion price points**: `buyPoint` = lower Bollinger band, `sellPoint` = upper band, `mean` = SMA20, and `at` = `'buy'` if price ≤ lower band, `'sell'` if price ≥ upper band, else null (used to highlight the point that price has reached).

### 7.5 Live-price overlay

For the watchlist signals endpoint, after computing from daily bars, overlay the live delayed quote: replace `price`, add `dayHigh/dayLow/dayOpen/volume/quoteTime`, and compute `change`/`changePct` versus `prevClose` (quote's prior close, else the last settled daily bar, else today's open).

### 7.6 Output object

`symbol, price, sma20, sma50, sma200, ema9, ema21, rsi, meanReversion{state,label,rsi,aboveSma50,buyPoint,sellPoint,mean,at}, percentB, range52Pct, rvol, stochK, stochD, vwap, cci, mfi, roc, adx, diPlus, diMinus, year52High, year52Low, buyZone, sellZone, stopLoss, rr, spyRegime, scores{core,tier1,tier2,adx,obv,regime → {score,max,signal}}, components{rsiSig,…,regimeSig}` plus the live-overlay fields.

### 7.7 Optional AI summary

If `ANTHROPIC_API_KEY` is set, `GET /api/signals/:symbol/summary` sends the key figures (price, RSI, ADX/DI, SMAs, zones, stop, R:R, core/tier2/regime scores, SPY regime) to a small, fast Claude model with a ~256-token cap, asking for a 2–3 sentence summary aimed at a 2–8 week position trader. Without a key, return a fixed "AI summary unavailable — set ANTHROPIC_API_KEY" message.

---

## 8. Backtest engine

Strategy: **RSI mean reversion with a trend filter and ATR exits.** Long only, one position at a time, no costs or slippage.

Inputs (defaults): `symbol`, `period` ∈ {6mo, 1y, **2y**, 3y, 5y}, `rsiOversold` **40**, `rsiOverbought` **65**, `rsiPeriod` **14**, `smaPeriod` **50**, `requireAboveSMA` **true**, `atrMultiplierStop` **2**, `atrMultiplierTarget` **4**. Fetch the period plus 280 warm-up days.

Per bar *i* (from index 50):

1. Compute RSI and ATR(14) using only bars ≤ *i* (no look-ahead). Skip if either is unavailable.
2. **Flat:** enter at the close when `RSI < oversold` and (if required) `close > SMA`. Set `stop = entry − stopMult·ATR`, `target = entry + targetMult·ATR`.
3. **In a trade**, exit in this priority order: low ≤ stop → exit at stop (`stop`); else high ≥ target → exit at target (`target`); else RSI > overbought → exit at close (`rsi_exit`); else last bar → exit at close (`end`).

Per trade: `entryDate, exitDate, entryPrice, exitPrice, stopPrice, targetPrice, pnlPct, exitReason, bars`.
Stats: `totalTrades, winners (pnl > 0), losers, winRate, totalPnlPct (sum), avgWinPct, avgLossPct, expectancy = winRate·avgWin + lossRate·avgLoss, largestWin, largestLoss, avgBars`. Persist each run to `backtest_results`.

The Backtest page must include a collapsible "How backtesting works" panel explaining why to backtest, this strategy's rules, each parameter, how to read the results, and that fills are idealized and costs are ignored.

---

## 9. Fundamentals (SEC EDGAR)

### 9.1 Ratio table

For each watchlist symbol: resolve ticker → CIK (zero-padded to 10 digits), fetch `companyfacts`, compute from US-GAAP XBRL facts:

- **TTM sums** (EPS, revenue, net income): prefer the latest 10-K annual value combined with subsequent quarters; otherwise sum the four most recent **single-quarter** (≈ 90-day duration) values. De-duplicate facts by period end (prefer the latest filing).
- **Balance-sheet items** (equity, debt, cash, shares): latest reported instant value.
- Try multiple concept names per metric (filers vary), e.g. revenue from `Revenues`, `RevenueFromContractWithCustomerExcludingAssessedTax`, `SalesRevenueNet`.

Derived fields: `trailingEps, trailingPE (price/EPS), forwardPE, forwardEps, priceToBook, evToEbitda, earningsGrowth (YoY TTM), revenueGrowth, profitMargin, returnOnEquity, debtToEquity, marketCap / enterprise value, pegRatio = PE / (earnings growth %)`. PEG is null when growth ≤ 0 or PE is null. Price-dependent ratios are recomputed on each request with a live price (fetched in parallel, **capped at 5 s**; on timeout use the cached ratios). Cache results 30 days (§4.3).

Colour rules: PEG < 1 green, 1–2 yellow, > 2 red; P/E > 35 red, < 15 green.

### 9.2 TTM trend series ("12-month moving average")

For each symbol produce a quarterly series of rolling 4-quarter sums, oldest first:

- For each window *i* of 4 consecutive single-quarter values: `{ date: quarter end, value: sum }`.
- **YoY growth** for window *i* = (value − value 4 windows earlier)/|earlier value| × 100.
- Merge EPS, revenue, and net-income series by quarter-end date into rows `{ date, epsTTM, revTTM, niTTM, marginPct = niTTM/revTTM×100, epsGrowthPct, revGrowthPct }`. Missing values are null (charts connect across gaps).

Known caveat to surface in the UI: stock splits distort EPS series (e.g. a 10:1 split makes pre-split EPS look 10× larger), and companies with shifting fiscal quarter-end dates can produce slightly misaligned merges.

---

## 10. Macro modules

All three modules combine a **curated baseline** (so pages always render offline) with **live overlays** where a keyless source exists. All curated values are labelled approximate with an "as of" date.

### 10.1 Crash History (corrections vs. interest rates)

**Dataset:** 18 US equity corrections of roughly 15%+ over ~100 years: 1929, 1937–38, 1946, 1962, 1966, 1968–70, 1973–74, 1980, 1981–82, 1987, 1990, 1998, 2000–02, 2007–09, 2011, Q4 2018, 2020, 2022. Fields per episode: `id, name, peak (YYYY-MM), trough, drawdownPct, fedFunds (null pre-1954), tenYear, curveInverted (bool|null), cpiYoY, unemployment, rateRegime ('hiking'|'cutting'|'holding'), recessionFollowed, trigger, notes`.

**Summary statistics:** count, average and median drawdown, average fed funds (post-1954), average CPI and unemployment; the share of episodes preceded by hiking, with an inverted curve (of those known), followed by recession, and with CPI ≥ 4%; **Pearson correlations** of drawdown depth against fed funds, CPI and 10-year yield, each with its scatter points. Label the correlations "small sample — descriptive only".

**"Where are we now?" checklist** — five classic pre-crash conditions, each present/absent/unknown:

| Condition | Present when |
|---|---|
| Policy rate restrictive | Fed funds ≥ 4% |
| Yield curve inverted | 10y − 2y < 0 |
| Inflation elevated | CPI YoY > 4% |
| Credit spreads stressed | HY OAS > 5% |
| Unemployment rising | latest > 3 months ago |

Values come from FRED when `FRED_API_KEY` is set; otherwise the user enters them manually (a POST scores the manual snapshot). **The system must never invent present-day values.**

**Page:** headline stats, the checklist, three correlation scatter charts, a drawdown-by-episode bar chart, and a sortable episode table.

### 10.2 Japan / US-Treasury Watch

Question answered: how likely is Japan (largest foreign holder of US Treasuries, ~$1.2T) to sell Treasuries to defend the yen?

- **Snapshot:** USD/JPY (live from Frankfurter), multi-decade low, BOJ rate, Fed funds (FRED overlay if keyed, else curated), **rate gap = Fed − BOJ**, Japan's holdings, total foreign holdings, date of last intervention, whether the Fed's FIMA repo facility is in use.
- **Sell-off risk gauge** — four checks:

  | Check | Present when |
  |---|---|
  | Yen in intervention zone | USD/JPY ≥ 160 |
  | Near disorderly lows | USD/JPY ≥ 98% of the multi-decade low |
  | Wide rate differential | Fed − BOJ ≥ 2.5% |
  | No repo backstop | FIMA repo not in use |

  Level: ≥ 3 → High, 2 → Moderate, else Low.
- **Four-scenario table** (name, likelihood, US impact): disruptive fire-sale (Low); measured sales during intervention (Moderate, capped); borrow-not-sell via FIMA repo + joint intervention (High — current path); slow structural decline in Japanese demand (High / ongoing).
- **Three lists:** why a big sell-off is unlikely / what raises the risk / what lowers it.
- **USD/JPY chart** with a 160 reference line and a timeframe selector (§13.3).
- **News feed** (§10.4).

### 10.3 China / De-Dollarization Watch

- **Snapshot:** USD/CNY (live), PBoC gold tonnes, gold as % of reserves, China's US Treasury holdings and their 2013 peak, yuan share of SWIFT payments, USD share of global reserves, CIPS annual throughput.
- **Momentum gauge** — four structural shifts: PBoC accumulating gold (always true in the baseline); UST holdings < $700B; CIPS throughput ≥ $200T/yr; USD reserve share ≤ 60%. ≥ 3 → High, 2 → Moderate, else Low. Caption: *momentum is not replacement*.
- **Charts:** USD/CNY with timeframe selector; PBoC gold reserves (tonnes, curated yearly points, area); China UST holdings ($B, curated yearly points, line).
- **Four-pillar table** (pillar, status, where it stands): petroyuan; gold as a sanctions-proof anchor; the oil → yuan → gold loop; Treasuries out plus non-SWIFT rails (CIPS, mBridge, e-CNY).
- **Three lists:** what's genuinely happening / the hard limits (capital controls, rule of law, network effects, insufficient gold backing) / realistic outlook.
- **News feed.**

### 10.4 News feed

`GET /api/macro/news?topic=japan|china`. Each topic maps to a fixed Google News query (Japan: yen intervention / Bank of Japan / US Treasuries; China: de-dollarization / petroyuan / PBoC gold / yuan reserves). Parse up to 8 items: `title, link, pubDate, source`. Strip a trailing `" - Source"` from titles. No XML library is required. The UI lists the headline (opens in a new tab with `rel="noopener noreferrer"`), source, and relative age ("3h ago"). Unknown topic → 400.

---

## 11. Alerts

- **Types:** `price` (repeating) and `price_once` (deactivates after firing). **Conditions:** `above` (price > value), `below` (price < value).
- **Evaluation:** a cron job runs **every 15 minutes, 14:00–21:59 UTC, Monday–Friday** (US market hours). For each distinct watchlist symbol (≥ 350 ms between symbols): fetch daily history, run the signal engine, check alerts against the price, and append a `signal_history` row with the regime signal, score, max and component JSON.
- **On fire:** insert into `alert_log`; deactivate if `price_once`; broadcast over **Server-Sent Events** to all connected clients as `{ type: 'alert', symbol, message, price, alertId }`; send email (if SMTP is configured) and web-push notifications (if VAPID keys are configured) without blocking. Delete push subscriptions that return HTTP 410.
- **Frontend:** a global toast bar subscribes to `/api/alerts/stream` and shows fired alerts on any page.

---

## 12. Backend HTTP API

All under `/api`. Errors return `{ error: string }` with 4xx/5xx. Symbols are upper-cased server-side.

| Method & path | Purpose |
|---|---|
| `GET /health` | `{ ok: true, time }` |
| `GET /vapid-public-key` | `{ publicKey | null }` |
| **Watchlist** | |
| `GET /watchlist` | `[{ symbol, added_at }]` |
| `POST /watchlist` `{symbol}` | add (ignore duplicates) |
| `DELETE /watchlist/:symbol` | remove |
| **Market** | |
| `GET /market/indicators?symbol&period&interval` | `period` ∈ 1mo, 3mo, 6mo, 1y, 2y. Returns the trimmed period's `candles` plus aligned arrays `sma20, sma50, sma200, ema9, ema21, vwap, bb, supertrend`, and `quote { regularMarketPrice, previousClose, open, dayHigh, dayLow, volume, avgVolume, fiftyTwoWeekHigh, fiftyTwoWeekLow, liveAt }`. Indicators are computed over the full warm-up range, then trimmed. |
| `GET /market/quote?symbols=A,B` | live quotes |
| `GET /market/fundamentals?symbols=A,B` | §9.1 rows |
| `GET /market/moving-average?symbols=A,B` | §9.2 series per symbol |
| **Signals** | |
| `GET /signals/watchlist` | §7.6 for every watchlist symbol (sequential, throttled), plus SPY flagged `isSpy: true` if not in the watchlist |
| `GET /signals/:symbol` | single symbol; 404 "Insufficient data" if < 50 bars |
| `GET /signals/:symbol/summary` | `{ symbol, summary }` (§7.7) |
| **Options** | |
| `GET /options/:symbol?date=<unix>` | `{ underlyingSymbol, expirationDates (ms, ascending), quote{regularMarketPrice}, options:[{calls, puts}] }` for the expiry nearest `date` (±36 h) or the first expiry. Contract fields: `contractSymbol, strike, expiration, lastPrice, bid, ask, volume, openInterest, impliedVolatility, delta, gamma, theta, vega, inTheMoney, change, percentChange`. |
| **Alerts** | |
| `GET /alerts`, `POST /alerts` `{symbol, alert_type, condition, value, message}`, `DELETE /alerts/:id`, `PATCH /alerts/:id/toggle` | CRUD |
| `GET /alerts/log` | recent fired alerts |
| `GET /alerts/stream` | SSE stream (§11) |
| `POST /alerts/subscribe` | store a web-push subscription |
| **Journal** | |
| `GET /journal`, `POST /journal` | list / create (`symbol, trade_type, direction, entry_date, entry_price, quantity, stop_loss, target_price, notes, tags`) |
| `PATCH /journal/:id/close` `{exit_date, exit_price}` | close and compute `pnl = (exit − entry) × qty` (sign inverted for short) |
| `DELETE /journal/:id` | delete |
| `GET /journal/stats` | `totalTrades, openTrades, closedTrades, totalPnl, winRate, winners, losers, avgWin, avgLoss, expectancy` |
| `GET /journal/:id/ai-analysis` | optional 2–3 sentence AI lesson (§7.7 pattern) |
| **Backtest** | |
| `POST /backtest/run` | §8 → `{ trades, stats }` |
| `GET /backtest/history`, `GET /backtest/:id` | saved runs |
| **Macro** | |
| `GET /macro/corrections` | `{ episodes, summary }` (§10.1) |
| `GET /macro/current` | FRED snapshot + checklist, or `{ live:false, reason }` |
| `POST /macro/score` | score a manually entered snapshot |
| `GET /macro/japan` | `{ live, snapshot, risk, framework, series }` |
| `GET /macro/china` | `{ live, snapshot, momentum, framework, series{gold,ust}, usdcnySeries }` |
| `GET /macro/news?topic` | `{ topic, items[] }` |

---

## 13. Frontend

### 13.1 Shell

- **Sidebar** (fixed width, icons + labels, active route highlighted), in this order: Dashboard, Chart, All Charts, Signals, Fundamentals, 12 MovingAve, Options, Calls Matrix, Alerts, Journal, Backtest, Crash History, Japan Watch, China Watch.
- **Header:** a symbol search box. On submit, if the current route is Chart, Options or Calls Matrix, navigate to that route with the new symbol; otherwise go to Chart.
- **Global alert toast bar** (§11).
- **Persistent client state** (Zustand persisted to `localStorage` under `stockapp-storage`): selected symbol; watchlist mirror; chart preferences (panel heights, period, interval, toggles for RSI/MACD/ADX/Volume, overlay toggles for SMA20/50/200, EMA9/21, VWAP, BB, Supertrend, mini-chart height); options preferences (view, filter, strike range, saved expiry dates); calls-matrix preferences (symbol, selected expiries, strike range). Saved dates must be **filtered against the live expiry list** on load so expired dates never reappear.

### 13.2 Shared components

- **Tip** — a small circled "i" beside every acronym (RSI, ADX, R:R, PEG, P/E, EPS, SMA, EMA, VWAP, BB, MACD, TTM, OBV, …). Hover shows a one-line definition. It takes a `below` prop to render the bubble beneath the icon; use it for elements near the top of a page so the bubble is not clipped.
- **LiveBadge** — last-updated time, a countdown to the next refresh, a loading pulse and a manual refresh button.
- **useAutoRefresh(callback, intervalMs)** — runs immediately, then on an interval; skips overlapping runs; pauses while the tab is hidden and refreshes immediately when it becomes visible.
- **SignalBadge / ScoreBar** — coloured label for the five signal levels, plus a bar proportional to score/max.
- **MeanRevBadge** — the §7.4 state pill.
- **FxChart** — area chart for a daily FX series with an inline **1M / 3M / 6M / 1Y / 2Y** selector (default 1Y). Slices the ~2-year series client-side (no refetch); optional reference line; unique gradient id per instance; graceful empty state.
- **NewsFeed** — §10.4.
- **ErrorBoundary** — §2.2.

### 13.3 Pages

| Page | Requirements |
|---|---|
| **Dashboard** | Add/remove watchlist symbols. Journal stat strip (Total P&L, Win Rate, Trades, Open). One card per symbol: price, day change (green/red with arrow), regime SignalBadge, Mean-Rev badge, RSI, ADX, R:R, and fundamentals PEG / P/E / EPS with Tips. Clicking a card opens its chart. Auto-refresh every 90 s. The watchlist loads independently so a slow signals call never blanks it. |
| **Chart** | lightweight-charts candlestick main panel with optional volume histogram. Period buttons 1mo–2y. Overlay toggles (SMA20/50/200, EMA9/21, VWAP, Bollinger, Supertrend coloured per point by trend). Sub-panels: RSI(14) with 30/70 guides, MACD (line, signal, histogram), ADX with DI±. **All panels are time-synchronised**: panning or zooming any panel applies the same visible range to the others (guard against feedback loops with a re-entrancy flag). Panels are vertically resizable, with heights persisted. Price header: live price, change, previous close, "quote as of". Stats row: open/high/low/volume/average volume/52-week high and low, plus last-bar and fetched timestamps. Mean-Rev marker shown. |
| **All Charts** | A grid of mini candlestick charts (3 months), one per watchlist symbol, each with a stat strip and an adjustable shared height; each wrapped in an ErrorBoundary. |
| **Signals** | Sortable table: Symbol (with bull/bear regime tag), Price, RSI (green < 40, red > 65), Mean Rev (badge, plus B/S points that highlight when reached), ADX (yellow ≥ 25), Buy Zone, Stop, Target, R:R, then six score columns Core/6 … +Rgm/19 (badge + bar). Header Tips explain each score tier's components. SPY regime banner. Rows expand to show all indicator values and a dot per component vote (green/red/gray), plus a Mean Reversion section (buy point / 20-day mean / sell point). Auto-refresh every 60 s. |
| **Fundamentals** | Compact ratio table (§9.1), **half page width on large screens**, horizontally scrollable, sortable, with header Tips and a colour legend. Below it, a **multi-select TTM trend chart**: chips to choose any indicators (EPS, Revenue, Net Income, Margin, EPS Growth, Revenue Growth) and any watchlist stocks; one line per (stock × indicator). Scale toggle **Absolute / Indexed (first point = 100)**; indexed is forced whenever more than one indicator is selected (mixed units). |
| **12 MovingAve** | Six metric tabs over the §9.2 series with one line per symbol, plus a latest-TTM snapshot table with green/red growth. |
| **Options** | Symbol options chain. Expiry-date chips (Fridays; LEAPS grouped), multi-select and persisted. View Calls / Puts / Both; filter All / ITM / OTM; strike min/max. Columns: Strike, %ATM (strike's distance from the underlying price, %), Last, Bid, Ask, Volume. A strike within ±1.5% of the underlying is ATM (highlighted yellow); ITM rows are tinted blue. (The API also returns OI, IV and greeks for future use.) Controls header **stays frozen** while the table scrolls. |
| **Calls Matrix** | Choose several expiries and a strike range, then "Build Matrix": rows = strikes, columns = expiries (sorted), each cell shows last, bid/ask and IV. Frozen controls header. Only non-expired dates may ever appear as columns. |
| **Alerts** | Create price alerts (symbol, above/below, value, one-time or repeating), list with an active toggle and delete, and a fired-alert log. |
| **Journal** | Add trades; close open trades with exit date and price; delete; list with P&L colouring; stats; optional AI lesson per trade. |
| **Backtest** | §8 form, eight stat cards, per-trade P&L bar chart (green/red), expandable trade list, and the explainer panel. |
| **Crash History** | §10.1. |
| **Japan Watch** | §10.2. Live badge shows "live · USD/JPY <date>" or "curated · as of <date>". |
| **China Watch** | §10.3. |

---

## 14. Configuration

`backend/.env` (template provided as `backend/.env.example`):

| Variable | Required | Purpose |
|---|---|---|
| `TWELVEDATA_API_KEY` | **Yes** for charts/signals/backtest | price history |
| `PORT` | prod | listen port |
| `API_PORT` | no | dev API port (default 3001) |
| `FRONTEND_URL` | no | dev CORS origin (default `http://localhost:5173`) |
| `NODE_ENV` | prod | `production` enables static SPA serving |
| `ANTHROPIC_API_KEY` | no | AI summaries |
| `FRED_API_KEY` | no | live macro snapshot, Fed funds overlay |
| `SMTP_HOST/PORT/USER/PASS/FROM` | no | email alerts (sent to `SMTP_USER`) |
| `VAPID_SUBJECT/PUBLIC_KEY/PRIVATE_KEY` | no | web push |

Without `TWELVEDATA_API_KEY`, the Options, FX, macro, news and fundamentals features must still work; history-dependent pages show an error card naming the missing key.

---

## 15. Build, run, deploy

**Root scripts:**

- `install:all` — installs the root (provides `concurrently`), backend and frontend dependencies.
- `dev` — runs backend (nodemon, auto-reload) and frontend (Vite) together, with labelled output.
- `build:frontend`, `start:backend`.

**Local run:** `npm run install:all`, then `npm run dev`, then open `http://localhost:5173`.

**Windows convenience launchers:**

- `setup.bat` — checks that Node is installed (and links to nodejs.org if not), copies `.env.example` → `.env` if missing, runs `install:all`, and prints next steps.
- `start.bat` — refuses to run if dependencies are missing, opens the browser after about 9 s, and runs `npm run dev`.

Include a plain-language `SETUP-WINDOWS.md`.

**Hosted:** build the frontend, then start the backend with `NODE_ENV=production`; health check at `/api/health`. On ephemeral hosts the SQLite file is lost on redeploy unless a persistent volume is attached.

---

## 16. Non-functional requirements

- **Performance:** the first load of a cached page returns in < 1 s; uncached TwelveData fetches are rate-limited (expect ~8 s per new symbol). Price-dependent fundamentals never block longer than 5 s on the live price.
- **Freshness:** live prices ≤ 90 s stale during market hours; daily bars refresh within 15 min during market hours and once after the close.
- **Correctness:** no indicator uses future bars (backtest is strictly causal). Expired option dates never display.
- **Resilience:** a single failed source, symbol or chart never crashes a page or the server.
- **Security:** API keys live only in `backend/.env` (git-ignored) and are never sent to the browser. External links open with `noopener`. SEC requests identify the app with a contact email. No user data leaves the machine except to the listed sources.
- **Accessibility/UX:** dark theme; numbers in a monospace font; colour is paired with text or sign for gains and losses; every acronym has a Tip.

---

## 17. Known limitations and out of scope

- Single user; no authentication or multi-tenancy.
- Data is delayed (~15 min); this is not a trading-execution system and places no orders.
- Curated macro baselines (Japan/China snapshots, PBoC gold and UST yearly points, crash dataset) must be updated by hand; the UI shows their as-of date.
- SEC EDGAR TTM series are distorted by stock splits and occasionally misaligned by shifting fiscal quarter ends.
- The backtester models no commissions, slippage, gaps-through-stop pricing, or position sizing.
- The free TwelveData tier limits how many symbols can be refreshed per minute and per day.
- Out of scope: brokerage integration, intraday bars, mobile apps, multi-currency portfolios, and tax reporting.
