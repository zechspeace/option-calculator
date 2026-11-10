export async function fetchTickerSearch(query, market = 'US') {
  const params = new URLSearchParams({
    q: query,
    quotesCount: '8',
    newsCount: '0',
    enableFuzzyQuery: 'false',
    region: market === 'CA' ? 'CA' : 'US',
    lang: 'en-US',
  })
  const res = await fetch(`/api/search?${params}`)
  if (!res.ok) throw new Error('Search failed')
  const data = await res.json()

  const validTypes = new Set(['EQUITY', 'ETF'])
  let quotes = (data.quotes ?? []).filter(q => validTypes.has(q.quoteType) && q.symbol)

  if (market === 'CA') {
    quotes.sort((a, b) => {
      const aIsCa = a.symbol.endsWith('.TO') || a.symbol.endsWith('.V') || a.exchange === 'TOR'
      const bIsCa = b.symbol.endsWith('.TO') || b.symbol.endsWith('.V') || b.exchange === 'TOR'
      if (aIsCa && !bIsCa) return -1
      if (!aIsCa && bIsCa) return 1
      return 0
    })
  }

  return quotes.slice(0, 5).map(q => {
    let exch = q.exchDisp || q.exchange || ''
    if (exch === 'TOR' || exch.toLowerCase() === 'toronto') exch = 'TSX'
    if (exch === 'VAN' || exch.toLowerCase().includes('venture')) exch = 'TSXV'
    return {
      symbol: q.symbol,
      name: q.shortname ?? q.longname ?? '',
      exchange: exch,
      isCanadian: q.symbol.endsWith('.TO') || q.symbol.endsWith('.V') || q.exchange === 'TOR' || q.exchange === 'VAN',
    }
  })
}
