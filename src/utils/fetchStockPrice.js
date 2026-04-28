/**
 * Fetch the latest market price for a ticker via the Yahoo Finance chart API.
 * Requests are proxied through Vite to avoid CORS (see vite.config.js).
 * Returns { price, currency } or throws an Error.
 */
export async function fetchStockPrice(ticker) {
  const symbol = ticker.trim().toUpperCase()
  const url = `/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
  const res = await fetch(url)
  if (res.status === 404) throw new Error('Ticker not found')
  if (res.status === 429) throw new Error('Rate limited — try again in a few seconds')
  if (!res.ok) throw new Error(`Server error (${res.status})`)
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) throw new Error('Ticker not found')
  const price = result.meta.regularMarketPrice
  const currency = result.meta.currency ?? 'USD'
  const previousClose = result.meta.chartPreviousClose ?? result.meta.previousClose ?? price
  const changePercent = ((price - previousClose) / previousClose) * 100
  return { price, currency, changePercent }
}
