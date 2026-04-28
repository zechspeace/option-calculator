# Covered Call ROI Calculator

A web app for evaluating covered call and cash-secured put options. Enter a stock ticker, pick an expiration date, select a strike from the live option chain, and instantly see the annualized ROI.

## What it does

1. **Fetches live data** — stock price and available option expiration dates are pulled from Yahoo Finance when you type a ticker. Press Enter or wait for the debounce to trigger the lookup.
2. **Ticker autocomplete** — as you type, up to 5 matching US equity tickers are suggested from Yahoo Finance search. Navigate with arrow keys, select with Enter, or click.
3. **Shows the option chain** — call and put strikes for the selected expiry, with open interest, volume, IV, Black-Scholes delta, and mid price. The at-the-money row is highlighted and scrolled into view automatically. A price separator line marks where the current stock price falls in the chain.
4. **Calculates ROI** — click any strike to see:
   - **Calls — CC ROI (annualized):** `(mid / DTE × 365) / stock price`
   - **Calls — CC + Yield:** combines CC ROI with the stock's trailing dividend yield pro-rated to the DTE
   - **Puts — Cash-Secured Put Return (annualized):** `(mid / strike / DTE) × 365`
5. **Mid price override** — after selecting a strike, you can manually enter a different mid price to recalculate ROI (useful when legging in at a specific fill).

Recent tickers are saved to `localStorage` and shown as quick-select chips. Hover a chip to reveal an × button that removes it from history.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Other commands:

```bash
npm run build      # Production build
npm run preview    # Preview production build
npm run lint       # ESLint
```

## How the Yahoo Finance proxy works

Yahoo Finance requires cookies and a session crumb for authenticated API calls. The dev server handles this transparently:

- Stock price requests (`/api/yahoo/...`) are forwarded via Vite's built-in proxy.
- Option chain requests (`/api/options/:symbol`) go through a custom Vite middleware that negotiates and caches a Yahoo session (cookies + crumb) server-side for 25 minutes, with automatic refresh on expiry.
- Ticker search/autocomplete requests (`/api/search`) are forwarded via Vite's built-in proxy to Yahoo Finance's search endpoint.

**This proxy only runs in dev.** Deploying to production requires a real backend that replicates this session logic.

## Stack

- React 19 + Vite
- Tailwind CSS v4
- Black-Scholes delta computed client-side (Abramowitz & Stegun approximation, risk-free rate hardcoded at 4.5%)
