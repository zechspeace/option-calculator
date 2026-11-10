import https from 'node:https'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export function isCanadianSymbol(symbol = '', market = '') {
  if (market === 'CA') return true
  const upper = symbol.trim().toUpperCase()
  return /\.(TO|VN|V|NE|CN)$/i.test(upper)
}

export function normalizeCanadianSymbol(symbol = '') {
  const upper = symbol.trim().toUpperCase()
  if (!upper) return ''
  if (/\.(TO|VN|V|NE|CN)$/i.test(upper)) return upper
  return `${upper}.TO`
}

export function getMxRootSymbol(symbol = '') {
  let clean = symbol.trim().toUpperCase().replace(/\.(TO|VN|V|NE|CN)$/i, '')
  if (clean.includes('.')) clean = clean.split('.')[0]
  return clean
}

function internalHttpsGet(urlStr, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const req = https.get(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        maxHeaderSize: 65536,
        headers: { 'User-Agent': UA, Accept: '*/*', ...extraHeaders },
      },
      (res) => {
        const cookies = res.headers['set-cookie'] ?? []
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (d) => { body += d })
        res.on('end', () => resolve({ status: res.statusCode, body, cookies, headers: res.headers }))
      },
    )
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('Request timed out')))
    req.end()
  })
}

// In-memory cache for Montreal Exchange options: mxRoot -> { timestamp, expirationDates, strikes, optionsByDate, quote }
const mxCache = new Map()
const CACHE_TTL_MS = 5 * 60 * 1000

export async function getCanadianOptionChain(symbol, date, session, customHttpsGet) {
  const getFn = customHttpsGet || internalHttpsGet
  const mxRoot = getMxRootSymbol(symbol)
  const caYahooSym = normalizeCanadianSymbol(symbol)

  let cached = mxCache.get(mxRoot)
  const now = Date.now()

  if (!cached || now - cached.timestamp > CACHE_TTL_MS) {
    const mxUrl = `https://www.m-x.ca/en/trading/data/quotes?symbol=${encodeURIComponent(mxRoot)}`
    const mxRes = await getFn(mxUrl)
    if (mxRes.status !== 200) {
      throw new Error(`Montreal Exchange returned status ${mxRes.status}`)
    }

    const html = mxRes.body
    const regex = /data-row='([^']+)'/g
    let match
    const optionsByDate = {}
    const strikesSet = new Set()
    let rowCount = 0

    while ((match = regex.exec(html)) !== null) {
      try {
        const decoded = match[1]
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#039;/g, "'")
        const row = JSON.parse(decoded)
        rowCount++

        const expiryStr = row.call?.expiry_date || row.put?.expiry_date
        if (!expiryStr) continue

        const [y, m, d] = expiryStr.split('-').map(Number)
        const expTimestamp = Math.floor(Date.UTC(y, m - 1, d) / 1000)

        if (!optionsByDate[expTimestamp]) {
          optionsByDate[expTimestamp] = { calls: [], puts: [] }
        }

        if (row.call && row.call.strike_price != null) {
          const strike = Number(row.call.strike_price)
          strikesSet.add(strike)
          optionsByDate[expTimestamp].calls.push({
            contractSymbol: row.call.symbol || `${mxRoot} C${strike}`,
            strike,
            currency: 'CAD',
            lastPrice: Number(row.call.last_price ?? 0),
            change: Number(row.call.net_change ?? 0),
            percentChange: 0,
            volume: Number(row.call.volume ?? 0),
            openInterest: Number(row.call.open_interest ?? 0),
            bid: Number(row.call.bid_price ?? 0),
            ask: Number(row.call.ask_price ?? 0),
            contractSize: 'REGULAR',
            expiration: expTimestamp,
            lastTradeDate: 0,
            impliedVolatility: Number(row.call.volatility ?? 0) / 100,
            inTheMoney: false,
          })
        }

        if (row.put && row.put.strike_price != null) {
          const strike = Number(row.put.strike_price)
          strikesSet.add(strike)
          optionsByDate[expTimestamp].puts.push({
            contractSymbol: row.put.symbol || `${mxRoot} P${strike}`,
            strike,
            currency: 'CAD',
            lastPrice: Number(row.put.last_price ?? 0),
            change: Number(row.put.net_change ?? 0),
            percentChange: 0,
            volume: Number(row.put.volume ?? 0),
            openInterest: Number(row.put.open_interest ?? 0),
            bid: Number(row.put.bid_price ?? 0),
            ask: Number(row.put.ask_price ?? 0),
            contractSize: 'REGULAR',
            expiration: expTimestamp,
            lastTradeDate: 0,
            impliedVolatility: Number(row.put.volatility ?? 0) / 100,
            inTheMoney: false,
          })
        }
      } catch {
        // Ignore single malformed row
      }
    }

    if (rowCount === 0) {
      throw new Error(`No options data available for ${symbol} on Montreal Exchange (MX)`)
    }

    const expirationDates = Object.keys(optionsByDate).map(Number).sort((a, b) => a - b)
    const strikes = [...strikesSet].sort((a, b) => a - b)

    // Fetch quote, company name & dividend info from Yahoo Finance quoteSummary
    let quote = {
      symbol: caYahooSym,
      currency: 'CAD',
      trailingAnnualDividendYield: 0,
      longName: '',
      shortName: '',
      regularMarketPrice: null,
    }

    try {
      if (session?.crumb && session?.cookieStr) {
        const qsUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(caYahooSym)}?crumb=${session.crumb}&modules=summaryDetail,price`
        const qsRes = await getFn(qsUrl, { Cookie: session.cookieStr })
        const qsData = JSON.parse(qsRes.body)
        const sd = qsData?.quoteSummary?.result?.[0]?.summaryDetail
        const pr = qsData?.quoteSummary?.result?.[0]?.price
        if (sd || pr) {
          quote.trailingAnnualDividendYield = sd?.dividendYield?.raw ?? sd?.trailingAnnualDividendYield?.raw ?? 0
          quote.longName = pr?.longName ?? ''
          quote.shortName = pr?.shortName ?? ''
          quote.regularMarketPrice = pr?.regularMarketPrice?.raw ?? null
        }
      }
    } catch {
      // Continue with MX fallbacks if Yahoo quoteSummary fails
    }

    // Fallback: extract last price from MX HTML if Yahoo price not obtained
    if (!quote.regularMarketPrice) {
      const priceMatch = html.match(/<li>Last price:\s*<b>([\d.]+)<\/b><\/li>/i)
      if (priceMatch) {
        quote.regularMarketPrice = parseFloat(priceMatch[1])
      }
    }
    if (!quote.longName && !quote.shortName) {
      quote.shortName = mxRoot
    }

    cached = {
      timestamp: now,
      expirationDates,
      strikes,
      optionsByDate,
      quote,
    }
    mxCache.set(mxRoot, cached)
  }

  // Resolve requested expiry date
  let selectedTs = cached.expirationDates[0]
  if (date) {
    const target = Number(date)
    if (cached.optionsByDate[target]) {
      selectedTs = target
    } else {
      selectedTs = cached.expirationDates.reduce((prev, curr) =>
        Math.abs(curr - target) < Math.abs(prev - target) ? curr : prev,
      )
    }
  }

  const selectedOpts = cached.optionsByDate[selectedTs] || { calls: [], puts: [] }

  return {
    optionChain: {
      result: [
        {
          underlyingSymbol: caYahooSym,
          expirationDates: cached.expirationDates,
          strikes: cached.strikes,
          hasMiniOptions: false,
          quote: cached.quote,
          options: [
            {
              expirationDate: selectedTs,
              hasMiniOptions: false,
              calls: selectedOpts.calls,
              puts: selectedOpts.puts,
            },
          ],
        },
      ],
      error: null,
    },
  }
}
