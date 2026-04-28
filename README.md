# Covered Call ROI Calculator

A web app for evaluating covered call options. Enter a stock ticker, pick an expiration date, select a strike from the live option chain, and instantly see the annualized ROI.

## What it does

1. **Fetches live data** — stock price and available option expiration dates are pulled from Yahoo Finance when you type a ticker (600 ms debounce).
2. **Shows the option chain** — all call strikes for the selected expiry, with open interest, volume, IV, Black-Scholes delta, and mid price. The at-the-money row is highlighted and scrolled into view automatically.
3. **Calculates ROI** — click any strike to see:
   - **CC ROI (annualized):** `(mid / DTE × 365) / stock price`
   - **CC + Yield:** combines the above with the stock's trailing dividend yield pro-rated to the DTE

Recent tickers are saved to `localStorage` and shown as quick-select chips.

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

**This proxy only runs in dev.** Deploying to production requires a real backend that replicates this session logic.

## Stack

- React 19 + Vite
- Tailwind CSS v4
- Black-Scholes delta computed client-side (Abramowitz & Stegun approximation, risk-free rate hardcoded at 4.5%)
