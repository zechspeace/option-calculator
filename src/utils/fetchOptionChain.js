export async function fetchExpiryDates(ticker) {
  const sym = encodeURIComponent(ticker.trim().toUpperCase())
  const res = await fetch(`/api/options/${sym}`)
  if (!res.ok) throw new Error(`Server error (${res.status})`)
  const json = await res.json()
  if (json?.error) throw new Error(json.error)
  const result = json?.optionChain?.result?.[0]
  if (!result) throw new Error('No options data available')
  return {
    expirationDates: result.expirationDates ?? [],
    dividendYield: result.quote?.trailingAnnualDividendYield ?? 0,
    tickerName: result.quote?.longName ?? result.quote?.shortName ?? '',
  }
}

async function fetchOptionsForExpiry(ticker, timestamp) {
  const sym = encodeURIComponent(ticker.trim().toUpperCase())
  const res = await fetch(`/api/options/${sym}?date=${timestamp}`)
  if (!res.ok) throw new Error(`Server error (${res.status})`)
  const json = await res.json()
  if (json?.error) throw new Error(json.error)
  const result = json?.optionChain?.result?.[0]
  if (!result) throw new Error('No options data available')
  return result.options?.[0] ?? {}
}

export async function fetchCallsForExpiry(ticker, timestamp) {
  const opts = await fetchOptionsForExpiry(ticker, timestamp)
  return opts.calls ?? []
}

export async function fetchPutsForExpiry(ticker, timestamp) {
  const opts = await fetchOptionsForExpiry(ticker, timestamp)
  return opts.puts ?? []
}
