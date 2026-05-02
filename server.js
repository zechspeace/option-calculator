import express from 'express'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function httpsGet(urlStr, extraHeaders = {}) {
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

// Yahoo Finance session (cookies + crumb), cached 25 min
let _session = null

async function getSession() {
  if (_session && Date.now() < _session.expiresAt) return _session

  const init = await httpsGet('https://fc.yahoo.com')
  const cookieStr = init.cookies.map((c) => c.split(';')[0].trim()).join('; ')

  const crumbRes = await httpsGet('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    Cookie: cookieStr,
  })
  const crumb = crumbRes.body.trim()
  if (!crumb || crumb.startsWith('{') || crumb.startsWith('<')) {
    throw new Error(`Failed to obtain Yahoo crumb (got: ${crumb.slice(0, 60)})`)
  }

  _session = { cookieStr, crumb, expiresAt: Date.now() + 25 * 60 * 1000 }
  return _session
}

// Proxy helper — uses session cookies so Yahoo doesn't block the request
async function proxyYahoo(targetUrl, res) {
  try {
    const { cookieStr } = await getSession()
    const upstream = await httpsGet(targetUrl, {
      Cookie: cookieStr,
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://finance.yahoo.com/',
      'Origin': 'https://finance.yahoo.com',
    })
    res.status(upstream.status)
      .set('Content-Type', upstream.headers['content-type'] || 'application/json')
      .send(upstream.body)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// /api/yahoo/* → query2.finance.yahoo.com/*
// req.url under app.use strips the mount prefix, e.g. /v8/finance/chart/AAPL?...
app.use('/api/yahoo', (req, res) => {
  const target = `https://query2.finance.yahoo.com${req.url}`
  proxyYahoo(target, res)
})

// /api/search?... → query2.finance.yahoo.com/v1/finance/search?...
// Use req.query to avoid a stray trailing slash that app.use appends
app.get('/api/search', (req, res) => {
  const qs = new URLSearchParams(req.query).toString()
  const target = `https://query2.finance.yahoo.com/v1/finance/search?${qs}`
  proxyYahoo(target, res)
})

// /api/options/:symbol?date= — session-authenticated options chain
app.get('/api/options/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase()
  const { date } = req.query

  try {
    let { cookieStr, crumb } = await getSession()

    const buildUrl = (c) => {
      const u = new URL(`https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`)
      u.searchParams.set('crumb', c)
      if (date) u.searchParams.set('date', date)
      return u.toString()
    }

    let yfRes = await httpsGet(buildUrl(crumb), { Cookie: cookieStr })
    let data = JSON.parse(yfRes.body)

    const isUnauth = data?.optionChain?.error?.code === 'Unauthorized'
      || data?.finance?.error?.code === 'Unauthorized'
    if (isUnauth) {
      _session = null
      ;({ cookieStr, crumb } = await getSession())
      yfRes = await httpsGet(buildUrl(crumb), { Cookie: cookieStr })
      data = JSON.parse(yfRes.body)
    }

    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Serve React app
app.use(express.static(path.join(__dirname, 'dist')))
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
