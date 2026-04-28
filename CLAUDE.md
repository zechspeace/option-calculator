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

### Yahoo Finance proxy

Yahoo Finance requires cookies and a crumb token for authenticated requests. Since the browser can't make these requests directly (CORS + cookie negotiation), all Yahoo Finance calls are proxied through Vite's dev server:

- **`/api/yahoo/*`** — handled by Vite's built-in `server.proxy`, forwarded to `query2.finance.yahoo.com`. Used by `fetchStockPrice.js` for the chart/price endpoint.
- **`/api/options/:symbol`** — handled by `yahooOptionsPlugin()` in `vite.config.js`. This is a custom Vite middleware that maintains a server-side Yahoo session (cookies + crumb) cached for 25 minutes. It initializes the session via `fc.yahoo.com` (a lightweight endpoint that avoids Node's 16 KB header-overflow limit). Used by `fetchOptionChain.js`.

**This proxy only runs in dev.** A production deployment needs a real backend to replicate `yahooOptionsPlugin`.

### Data flow

1. User types a ticker → 600 ms debounce → `fetchStockPrice` and `fetchExpiryDates` fire in parallel.
2. `fetchExpiryDates` returns Unix timestamps (seconds) for available expirations; the app auto-selects the first expiry >25 DTE.
3. Selecting an expiry triggers `fetchCallsForExpiry`, which fetches the full call chain for that date.
4. User clicks a row in the option chain table to select a strike.
5. ROI is computed inline: annualized `(mid / dte * 365) / stockPrice`, plus combined CC+yield.

### Black-Scholes delta

Delta is calculated client-side in `CoveredCallForm.jsx` using the Abramowitz & Stegun approximation for `normalCDF` (max error ~7.5e-8). The risk-free rate is hardcoded as `RISK_FREE = 0.045`. Delta is displayed in the chain table and used to color-code ITM/OTM rows.

### `src/utils/optionDates.js`

Contains helpers (`thirdFriday`, `nextStandardExpiry`, `calcDte`, `toInputDate`) for standard monthly expiry date arithmetic. These are currently **not used** by `CoveredCallForm` — the component relies entirely on live expiry dates from Yahoo Finance instead.

### Ticker history

Up to 10 recently looked-up tickers are persisted to `localStorage` under the key `ticker-history` and shown as quick-select chips above the input.
