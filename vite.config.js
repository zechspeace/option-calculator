import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import https from 'node:https'

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
        res.on('end', () => resolve({ status: res.statusCode, body, cookies }))
      },
    )
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('Request timed out')))
    req.end()
  })
}

// Server-side Yahoo Finance session: cookies + crumb cached for 25 min.
// fc.yahoo.com is used for cookie init — lighter than finance.yahoo.com and
// avoids Node's 16 KB header-overflow limitation on the homepage response.
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

function yahooOptionsPlugin() {
  return {
    name: 'yahoo-options',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/options/')) return next()

        try {
          const url = new URL(req.url, 'http://localhost')
          const symbol = url.pathname.split('/')[3]?.toUpperCase()
          const date = url.searchParams.get('date')

          if (!symbol) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ error: 'Missing symbol' }))
          }

          let { cookieStr, crumb } = await getSession()

          const buildPath = (c) => {
            const u = new URL(`https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`)
            u.searchParams.set('crumb', c)
            if (date) u.searchParams.set('date', date)
            return u.toString()
          }

          let yfRes = await httpsGet(buildPath(crumb), { Cookie: cookieStr })
          let data = JSON.parse(yfRes.body)

          // If crumb expired, refresh session and retry once
          const isUnauth = data?.optionChain?.error?.code === 'Unauthorized'
            || data?.finance?.error?.code === 'Unauthorized'
          if (isUnauth) {
            _session = null
            ;({ cookieStr, crumb } = await getSession())
            yfRes = await httpsGet(buildPath(crumb), { Cookie: cookieStr })
            data = JSON.parse(yfRes.body)
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(data))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), yahooOptionsPlugin()],
  server: {
    proxy: {
      '/api/yahoo': {
        target: 'https://query2.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://finance.yahoo.com/',
          'Origin': 'https://finance.yahoo.com',
        },
      },
    },
  },
})
