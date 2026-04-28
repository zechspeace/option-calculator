export async function fetchTickerSearch(query) {
  const params = new URLSearchParams({
    q: query,
    quotesCount: '5',
    newsCount: '0',
    enableFuzzyQuery: 'false',
    region: 'US',
    lang: 'en-US',
  })
  const res = await fetch(`/api/search?${params}`)
  if (!res.ok) throw new Error('Search failed')
  const data = await res.json()
  return (data.quotes ?? [])
    .filter(q => q.quoteType === 'EQUITY' && q.symbol)
    .map(q => ({ symbol: q.symbol, name: q.shortname ?? q.longname ?? '' }))
    .slice(0, 5)
}
