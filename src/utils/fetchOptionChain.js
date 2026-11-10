export async function fetchExpiryDates(ticker, market) {
  const sym = encodeURIComponent(ticker.trim().toUpperCase())
  const qs = market ? `?market=${encodeURIComponent(market)}` : ''
  const res = await fetch(`/api/options/${sym}${qs}`)
  if (!res.ok) throw new Error(`Server error (${res.status})`)
  const json = await res.json()
  if (json?.error) throw new Error(json.error)
  const result = json?.optionChain?.result?.[0]
  if (!result || !result.expirationDates?.length) throw new Error('No options data available')
  return {
    expirationDates: result.expirationDates ?? [],
    dividendYield: result.quote?.trailingAnnualDividendYield ?? 0,
    tickerName: result.quote?.longName ?? result.quote?.shortName ?? '',
  }
}

async function fetchOptionsForExpiry(ticker, timestamp, market) {
  const sym = encodeURIComponent(ticker.trim().toUpperCase())
  const params = new URLSearchParams()
  if (timestamp) params.set('date', timestamp)
  if (market) params.set('market', market)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await fetch(`/api/options/${sym}${qs}`)
  if (!res.ok) throw new Error(`Server error (${res.status})`)
  const json = await res.json()
  if (json?.error) throw new Error(json.error)
  const result = json?.optionChain?.result?.[0]
  if (!result) throw new Error('No options data available')
  return result.options?.[0] ?? {}
}

export async function fetchCallsForExpiry(ticker, timestamp, market) {
  const opts = await fetchOptionsForExpiry(ticker, timestamp, market)
  return opts.calls ?? []
}

export async function fetchPutsForExpiry(ticker, timestamp, market) {
  const opts = await fetchOptionsForExpiry(ticker, timestamp, market)
  return opts.puts ?? []
}
