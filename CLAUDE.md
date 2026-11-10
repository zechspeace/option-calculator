# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server (includes Yahoo Finance proxy)
npm run build      # Production build
npm run preview    # Preview production build
npm run lint       # ESLint
```

There is no test framework configured.

## Architecture

This is a React 19 + Vite app styled with Tailwind CSS v4. The entire UI is a single component — `src/CoveredCallForm.jsx` — mounted directly from `App.jsx`. There are no routes.

### Yahoo Finance & Montreal Exchange proxy

US option chains are pulled from Yahoo Finance (requiring session cookies and a crumb token), while Canadian stock option chains (TSX/TSXV) are pulled from the **Bourse de Montréal (Montréal Exchange - MX)** via `server/canadianOptions.js` because Yahoo Finance does not provide option chain data for Canadian tickers.

Both dev (`vite.config.js` via `yahooOptionsPlugin`) and production (`server.js`) handle:
- **`/api/yahoo/*`** — forwarded to `query2.finance.yahoo.com` for charts/prices.
- **`/api/search`** — forwarded to `query2.finance.yahoo.com/v1/finance/search` for ticker autocomplete, supporting both US and Canadian markets (`region: CA` / `US`) and displaying exchange badges (`TSX`, `NYSE`, `NASDAQ`, etc.).
- **`/api/options/:symbol`** — automatically routes to Montreal Exchange for Canadian symbols (e.g. `SHOP.TO`, `RY.TO`, `XIU.TO`, or when `market=CA`) or falls back from Yahoo Finance if no US options are returned. Caches parsed MX chains in-memory for 5 minutes.

### Canadian Stock Support
- **Market Selector**: The user can toggle between **US (NYSE/NASDAQ)** and **Canada (TSX/MX)**.
- **Auto-Detection**: Entering tickers ending in `.TO`, `.V`, etc. automatically sets Canada mode.
- **Symbol Normalization**: In Canada mode, typing `SHOP` or `RY` automatically normalizes to `SHOP.TO` / `RY.TO` for TSX quotes and MX option chains.
- **Currency**: CAD (`C$`) is formatted for Canadian stocks and USD (`$`) for US stocks across all price, strike, and mid-price displays.

### Data flow

1. User types a ticker → 600 ms debounce → `fetchStockPrice` and `fetchExpiryDates` fire in parallel.
2. `fetchExpiryDates` returns Unix timestamps (seconds) for available expirations; the app auto-selects the first expiry >25 DTE.
3. Selecting an expiry triggers `fetchCallsForExpiry`, which fetches the full call chain for that date.
4. User clicks a row in the option chain table to select a strike.
5. ROI is computed inline: annualized `(mid / dte * 365) / stockPrice`, plus combined CC+yield (`roi + dividendYield`).

### Black-Scholes delta

Delta is calculated client-side in `CoveredCallForm.jsx` using the Abramowitz & Stegun approximation for `normalCDF` (max error ~7.5e-8). The risk-free rate is hardcoded as `RISK_FREE = 0.045`. Delta is displayed in the chain table and used to color-code ITM/OTM rows.

### `src/utils/optionDates.js`

Contains helpers (`thirdFriday`, `nextStandardExpiry`, `calcDte`, `toInputDate`) for standard monthly expiry date arithmetic. These are currently **not used** by `CoveredCallForm` — the component relies entirely on live expiry dates from Yahoo Finance instead.

### Ticker history

Up to 10 recently looked-up tickers are persisted to `localStorage` under the key `ticker-history` as `{ symbol, market }` objects and shown as quick-select chips above the input (decorated with flag badges: 🇨🇦 / 🇺🇸). Clicking any saved chip automatically switches the app to that ticker's corresponding exchange (TSX vs NYSE/NASDAQ) and loads its data without manual switching. Existing legacy string histories are automatically migrated on load.
