import { useState, useEffect, useRef } from 'react'
import { fetchStockPrice } from './utils/fetchStockPrice'
import { fetchTickerSearch } from './utils/fetchTickerSearch'
import { fetchExpiryDates, fetchCallsForExpiry, fetchPutsForExpiry } from './utils/fetchOptionChain'

const RISK_FREE = 0.045

// Abramowitz & Stegun approximation — max error ~7.5e-8
function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
  const poly = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return x >= 0 ? 1 - poly : poly
}

function callDelta(S, K, T, sigma) {
  if (T <= 0 || sigma <= 0) return S > K ? 1 : 0
  const d1 = (Math.log(S / K) + (RISK_FREE + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
  return normalCDF(d1)
}

function putDelta(S, K, T, sigma) {
  return callDelta(S, K, T, sigma) - 1
}

function tsToDte(ts) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((ts * 1000 - today.getTime()) / 86_400_000)
}

function tsToLabel(ts) {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function fmt2(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function Field({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-semibold text-gray-700 tracking-wide uppercase">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

function Badge({ children, color = 'gray' }) {
  const colors = {
    gray:  'bg-gray-100 text-gray-600',
    green: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    red:   'bg-red-50 text-red-600 border border-red-200',
    blue:  'bg-blue-50 text-blue-700 border border-blue-200',
  }
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  )
}

const MAX_HISTORY = 10

function loadHistory() {
  try { return JSON.parse(localStorage.getItem('ticker-history') ?? '[]') } catch { return [] }
}

export default function CoveredCallForm() {
  const [tickerInput, setTickerInput] = useState('')
  const [ticker, setTicker] = useState('')
  const [tickerHistory, setTickerHistory] = useState(loadHistory)
  const [showAc, setShowAc] = useState(false)
  const [acIndex, setAcIndex] = useState(-1)
  const [acResults, setAcResults] = useState([])
  const [stockPrice, setStockPrice] = useState(null)
  const [currency, setCurrency] = useState('USD')
  const [changePercent, setChangePercent] = useState(null)
  const [fetchState, setFetchState] = useState('idle') // idle | loading | error
  const [fetchError, setFetchError] = useState('')

  const [expiryDates, setExpiryDates] = useState([]) // Unix timestamps (seconds)
  const [selectedExpiry, setSelectedExpiry] = useState(null)
  const [dividendYield, setDividendYield] = useState(0)
  const [tickerName, setTickerName] = useState('')

  const [chainState, setChainState] = useState('idle') // idle | loading | error
  const [calls, setCalls] = useState([])
  const [puts, setPuts] = useState([])
  const [selectedCall, setSelectedCall] = useState(null)
  const [selectedPut, setSelectedPut] = useState(null)
  const [activeTab, setActiveTab] = useState('call')
  const [midOverride, setMidOverride] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  function commitTicker(raw) {
    const sym = raw.trim().toUpperCase()
    setTickerInput(sym)
    setTicker(sym)
    setAcResults([])
    setShowAc(false)
  }
  const atmRowRef = useRef(null)

  // Debounced autocomplete search
  useEffect(() => {
    const q = tickerInput.trim()
    if (!q || !showAc) { setAcResults([]); return }
    const id = setTimeout(() => {
      fetchTickerSearch(q).then(setAcResults).catch(() => setAcResults([]))
    }, 200)
    return () => clearTimeout(id)
  }, [tickerInput, showAc])

  const isRefreshing = fetchState === 'loading' || chainState === 'loading'

  // Fetch stock price + available expiry dates when ticker changes
  useEffect(() => {
    const sym = ticker.trim()
    if (!sym) {
      setStockPrice(null)
      setChangePercent(null)
      setExpiryDates([])
      setSelectedExpiry(null)
      setDividendYield(0)
      setTickerName('')
      setCalls([])
      setSelectedCall(null)
      setFetchState('idle')
      return
    }
    setFetchState('loading')
    setFetchError('')

    ;(async () => {
      const [priceRes, datesRes] = await Promise.allSettled([
        fetchStockPrice(sym),
        fetchExpiryDates(sym),
      ])

      if (priceRes.status === 'rejected') {
        setStockPrice(null)
        setChangePercent(null)
        setExpiryDates([])
        setSelectedExpiry(null)
        setCalls([])
        setSelectedCall(null)
        setFetchError(priceRes.reason?.message ?? 'Failed to fetch')
        setFetchState('error')
        return
      }

      const { price, currency: cur, changePercent: chg } = priceRes.value
      setStockPrice(price)
      setCurrency(cur)
      setChangePercent(chg ?? null)
      setFetchState('idle')
      setTickerHistory(prev => {
        const next = [sym.toUpperCase(), ...prev.filter(t => t !== sym.toUpperCase())].slice(0, MAX_HISTORY)
        localStorage.setItem('ticker-history', JSON.stringify(next))
        return next
      })
      if (datesRes.status === 'fulfilled') {
        const { expirationDates, dividendYield: dy, tickerName: name } = datesRes.value
        setExpiryDates(expirationDates)
        setDividendYield(dy)
        setTickerName(name)
        const auto = expirationDates.find(ts => tsToDte(ts) > 25) ?? expirationDates.at(-1) ?? null
        setSelectedExpiry(auto)
      } else {
        setExpiryDates([])
        setDividendYield(0)
        setTickerName('')
        setSelectedExpiry(null)
        setChainState('error')
      }
    })()
  }, [ticker, refreshKey])

  // Fetch call + put chains whenever expiry selection changes
  useEffect(() => {
    if (!ticker.trim() || !selectedExpiry) {
      setCalls([])
      setPuts([])
      return
    }
    setChainState('loading')
    setSelectedCall(null)
    setSelectedPut(null)
    Promise.all([
      fetchCallsForExpiry(ticker.trim(), selectedExpiry),
      fetchPutsForExpiry(ticker.trim(), selectedExpiry),
    ])
      .then(([rawCalls, rawPuts]) => {
        setCalls(rawCalls)
        setPuts(rawPuts)
        setChainState('idle')
      })
      .catch(() => {
        setCalls([])
        setPuts([])
        setChainState('error')
      })
  }, [ticker, selectedExpiry, refreshKey])

  // Scroll ATM row into view whenever a new chain loads or the tab toggles
  useEffect(() => {
    const id = setTimeout(() => {
      atmRowRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' })
    }, 0)
    return () => clearTimeout(id)
  }, [calls, puts, activeTab])

  const dte = selectedExpiry ? tsToDte(selectedExpiry) : null
  const curSymbol = currency === 'USD' ? '$' : currency + ' '
  const hasAll = stockPrice !== null && selectedCall !== null && activeTab === 'call'
  const hasPutAll = selectedPut !== null && activeTab === 'put'

  const overrideVal = midOverride !== '' ? parseFloat(midOverride) : null
  const mid = overrideVal != null && !isNaN(overrideVal)
    ? overrideVal
    : selectedCall ? ((selectedCall.bid ?? 0) + (selectedCall.ask ?? 0)) / 2 : null
  const roi = mid != null && dte > 0 ? ((mid / dte) * 365) / stockPrice : null
  const ccYield = roi != null && dte > 0 ? (dividendYield / 365 * dte) + roi : null

  const putMid = overrideVal != null && !isNaN(overrideVal)
    ? overrideVal
    : selectedPut ? ((selectedPut.bid ?? 0) + (selectedPut.ask ?? 0)) / 2 : null
  const securePutReturn = putMid != null && selectedPut && dte > 0 ? (putMid / selectedPut.strike / dte) * 365 : null
  const selDelta = selectedCall && stockPrice && dte != null
    ? callDelta(stockPrice, selectedCall.strike, dte / 365, selectedCall.impliedVolatility)
    : null

  const sortedCalls = [...calls].sort((a, b) => b.strike - a.strike)
  const sortedPuts = [...puts].sort((a, b) => b.strike - a.strike)

  const atmStrike = stockPrice && calls.length
    ? calls.reduce((a, b) =>
        Math.abs(a.strike - stockPrice) < Math.abs(b.strike - stockPrice) ? a : b
      ).strike
    : stockPrice && puts.length
    ? puts.reduce((a, b) =>
        Math.abs(a.strike - stockPrice) < Math.abs(b.strike - stockPrice) ? a : b
      ).strike
    : null

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 flex items-start justify-center pt-6 pb-14 px-4">
      <div className="w-full max-w-2xl">

        {/* Form card */}
        <div className="bg-white rounded-2xl border border-gray-300 p-6 flex flex-col gap-6">

          {/* Recent tickers */}
          {tickerHistory.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tickerHistory.map(t => (
                <div
                  key={t}
                  className={`group relative inline-flex items-center justify-center rounded-full border text-xs font-semibold transition-colors px-3 py-1 ${
                    ticker === t
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200'
                  }`}
                >
                  <button
                    onClick={() => commitTicker(t)}
                    className="transition-transform group-hover:-translate-x-1.5"
                  >
                    {t}
                  </button>
                  <button
                    onClick={() => {
                      setTickerHistory(prev => {
                        const next = prev.filter(h => h !== t)
                        localStorage.setItem('ticker-history', JSON.stringify(next))
                        return next
                      })
                      if (ticker === t) { setTicker(''); setTickerInput('') }
                    }}
                    className={`absolute right-1.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${
                      ticker === t ? 'text-indigo-200 hover:text-white' : 'text-gray-400 hover:text-red-500'
                    }`}
                    aria-label={`Remove ${t}`}
                  >
                    <svg viewBox="0 0 8 8" className="w-2.5 h-2.5" fill="none">
                      <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Ticker */}
          <Field
            label="Stock Ticker"
            hint={
              fetchState === 'error'
                ? fetchError
                : fetchState === 'loading'
                ? 'Fetching data…'
                : stockPrice !== null
                ? null
                : 'e.g. AAPL, MSFT, TSLA'
            }
          >
            <div className="relative">
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={tickerInput}
                  onChange={e => {
                    const val = e.target.value.toUpperCase()
                    setTickerInput(val)
                    setAcIndex(-1)
                    setShowAc(true)
                    if (val === '') setTicker('')
                  }}
                  onFocus={() => setShowAc(true)}
                  onBlur={() => setTimeout(() => setShowAc(false), 150)}
                  onKeyDown={e => {
                    if (showAc && acResults.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        setAcIndex(i => Math.min(i + 1, acResults.length - 1))
                        return
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        setAcIndex(i => Math.max(i - 1, -1))
                        return
                      }
                      if (e.key === 'Escape') {
                        setShowAc(false)
                        setAcIndex(-1)
                        return
                      }
                      if (e.key === 'Enter' && acIndex >= 0) {
                        commitTicker(acResults[acIndex].symbol)
                        return
                      }
                    }
                    if (e.key === 'Enter') commitTicker(tickerInput)
                  }}
                  placeholder="AAPL"
                  maxLength={10}
                  className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-lg font-semibold tracking-widest text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition uppercase placeholder:font-normal placeholder:tracking-normal placeholder:text-gray-300"
                />
                {fetchState === 'loading' && (
                  <span className="absolute right-3 text-gray-400 animate-spin text-lg">⟳</span>
                )}
                {fetchState === 'error' && (
                  <span className="absolute right-3 text-red-400 text-lg">✕</span>
                )}
              </div>
              {showAc && acResults.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                  {acResults.map((r, i) => (
                    <li
                      key={r.symbol}
                      onMouseDown={() => commitTicker(r.symbol)}
                      onMouseEnter={() => setAcIndex(i)}
                      className={`flex items-baseline gap-2 px-4 py-2.5 cursor-pointer transition-colors ${
                        i === acIndex ? 'bg-indigo-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span className={`text-sm font-semibold tracking-widest ${i === acIndex ? 'text-indigo-700' : 'text-gray-900'}`}>
                        {r.symbol}
                      </span>
                      {r.name && (
                        <span className="text-xs text-gray-400 truncate">{r.name}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {tickerName && (
              <div className="flex items-center gap-2 mt-8">
                <p className="text-2xl font-medium text-gray-500">{tickerName}</p>
                <button
                  onClick={() => setRefreshKey(k => k + 1)}
                  disabled={isRefreshing}
                  title="Refresh"
                  className="text-gray-400 hover:text-indigo-500 disabled:opacity-40 transition-colors"
                >
                  <svg
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="currentColor"
                    className={`w-[1.3rem] h-[1.3rem] translate-y-[2px] ${isRefreshing ? 'animate-spin' : ''}`}
                  >
                    <path d="M10 11H7.101l.001-.009a4.956 4.956 0 0 1 .752-1.787 5.054 5.054 0 0 1 2.2-1.811c.302-.128.617-.226.938-.291a5.078 5.078 0 0 1 2.018 0 4.978 4.978 0 0 1 2.525 1.361l1.416-1.412a7.036 7.036 0 0 0-2.224-1.501 6.921 6.921 0 0 0-1.315-.408 7.079 7.079 0 0 0-2.819 0 6.94 6.94 0 0 0-1.316.409 7.04 7.04 0 0 0-3.08 2.534 6.978 6.978 0 0 0-1.054 2.505c-.028.135-.043.273-.063.41H2l4 4 4-4zm4 2h2.899l-.001.008a4.976 4.976 0 0 1-2.103 3.138 4.943 4.943 0 0 1-1.787.752 5.073 5.073 0 0 1-2.017 0 4.956 4.956 0 0 1-1.787-.752 5.072 5.072 0 0 1-.74-.61L7.05 16.95a7.032 7.032 0 0 0 2.225 1.5c.424.18.867.317 1.315.408a7.07 7.07 0 0 0 2.818 0 7.031 7.031 0 0 0 4.395-2.945 6.974 6.974 0 0 0 1.053-2.503c.027-.135.043-.273.063-.41H22l-4-4-4 4z"/>
                  </svg>
                </button>
              </div>
            )}
            {stockPrice !== null && (
              <div className="flex items-baseline justify-between mt-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-gray-900">
                    {curSymbol}{fmt2(stockPrice)}
                  </span>
                  {changePercent != null && (
                    <span className={`text-sm font-medium ${changePercent >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%
                    </span>
                  )}
                </div>
                {expiryDates.length > 0 && (
                  <div className="text-right">
                    <span className="text-xs text-gray-400 uppercase tracking-wide">Div. Yield </span>
                    <span className="text-sm font-semibold text-gray-700">
                      {dividendYield > 0 ? fmt2(dividendYield * 100) + '%' : '—'}
                    </span>
                  </div>
                )}
              </div>
            )}
          </Field>

          {/* Expiry selector — populated from live option data */}
          {expiryDates.length > 0 && (
            <Field label="Expiration Date">
              <div className="flex items-center gap-3">
                <select
                  value={selectedExpiry ?? ''}
                  onChange={e => setSelectedExpiry(Number(e.target.value))}
                  className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition"
                >
                  {expiryDates.map(ts => (
                    <option key={ts} value={ts}>
                      {tsToLabel(ts)} — {tsToDte(ts)} DTE
                    </option>
                  ))}
                </select>
                {dte !== null && (
                  <Badge color={dte > 0 ? 'blue' : 'red'}>
                    {dte > 0 ? `${dte} DTE` : dte === 0 ? 'Today' : 'Expired'}
                  </Badge>
                )}
              </div>
            </Field>
          )}

          {/* Option chain table */}
          {(chainState === 'loading' || calls.length > 0 || puts.length > 0 || chainState === 'error') && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                {/* Nav pill toggle */}
                <div className="flex items-center bg-gray-100 rounded-lg p-0.5 gap-0.5">
                  {['call', 'put'].map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-3 py-1 text-sm font-medium rounded-md transition-colors capitalize ${
                        activeTab === tab
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {chainState === 'loading' && (
                <div className="text-center py-8 text-gray-400 text-sm">
                  Loading option chain…
                </div>
              )}

              {chainState === 'error' && (
                <div className="text-center py-8 text-red-400 text-sm">
                  Failed to load option chain
                </div>
              )}

              {chainState === 'idle' && activeTab === 'call' && calls.length > 0 && (
                <>
                  <div className="overflow-auto rounded-xl border border-gray-200" style={{ maxHeight: 320 }}>
                    <table className="w-full text-left" style={{ fontSize: 13 }}>
                      <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
                        <tr>
                          <th className="px-3 py-2.5 font-semibold text-gray-600">Strike</th>
                          <th className="px-3 py-2.5 font-semibold text-gray-600 text-right">% Diff</th>
                          <th className="px-3 py-2.5 font-semibold text-gray-600 text-right">OI</th>
                          <th className="px-3 py-2.5 font-semibold text-gray-600 text-right">Volume</th>
                          <th className="px-3 py-2.5 font-semibold text-gray-600 text-right">IV</th>
                          <th className="px-3 py-2.5 font-semibold text-gray-600 text-right">Delta</th>
                          <th className="px-3 py-2.5 font-semibold text-gray-600 text-right">Mid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedCalls.map((c, i) => {
                          const isSelected = selectedCall?.contractSymbol === c.contractSymbol
                          const isAtm = c.strike === atmStrike
                          const d = stockPrice && dte != null
                            ? callDelta(stockPrice, c.strike, dte / 365, c.impliedVolatility)
                            : null
                          const midPrice = ((c.bid ?? 0) + (c.ask ?? 0)) / 2
                          const showPriceLine = stockPrice != null && i > 0
                            && sortedCalls[i - 1].strike > stockPrice
                            && c.strike <= stockPrice

                          return (
                            <>
                              {showPriceLine && (
                                <tr key="__price_line" className="bg-white">
                                  <td className="pl-[2px] pr-3 py-1.5" colSpan={7}>
                                    <div className="flex items-center gap-2">
                                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold flex-shrink-0 ${changePercent >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                                      {curSymbol}{fmt2(stockPrice)}
                                      {changePercent != null && (
                                        <span>{changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%</span>
                                      )}
                                    </span>
                                    <div className="flex-1 border-t border-gray-300" />
                                    </div>
                                  </td>
                                </tr>
                              )}
                              <tr
                                key={c.contractSymbol}
                                ref={isAtm ? atmRowRef : undefined}
                                onClick={() => { setSelectedCall(c); setMidOverride('') }}
                                className={`cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-indigo-50'
                                    : isAtm
                                    ? 'bg-amber-50 hover:bg-amber-200'
                                    : 'hover:bg-gray-200'
                                }`}
                              >
                                <td className={`px-3 py-2 font-semibold ${isSelected ? 'text-indigo-700' : isAtm ? 'text-amber-700' : 'text-gray-900'}`}>
                                  ${fmt2(c.strike)}
                                  {isAtm && (
                                    <span className="ml-1.5 text-xs font-normal text-amber-500">ATM</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  {(() => {
                                    const pct = ((c.strike - stockPrice) / stockPrice) * 100
                                    const color = pct > 0 ? 'text-emerald-600' : pct < 0 ? 'text-red-500' : 'text-gray-400'
                                    return <span className={color}>{pct > 0 ? '+' : ''}{pct.toFixed(2)}%</span>
                                  })()}
                                </td>
                                <td className="px-3 py-2 text-gray-600 text-right tabular-nums">
                                  {(c.openInterest ?? 0).toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-gray-600 text-right tabular-nums">
                                  {(c.volume ?? 0).toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-gray-600 text-right tabular-nums">
                                  {(c.impliedVolatility * 100).toFixed(1)}%
                                </td>
                                <td className="px-3 py-2 text-gray-600 text-right tabular-nums">
                                  {d != null ? d.toFixed(2) : '—'}
                                </td>
                                <td className="px-3 py-2 font-medium text-right tabular-nums text-gray-900">
                                  ${fmt2(midPrice)}
                                </td>
                              </tr>
                            </>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {!selectedCall && (
                    <p className="text-xs text-gray-400 text-center">Click a row to select a strike</p>
                  )}
                </>
              )}

              {chainState === 'idle' && activeTab === 'put' && puts.length > 0 && (
                <>
                  <div className="overflow-auto rounded-xl border border-gray-200" style={{ maxHeight: 320 }}>
                    <table className="w-full text-left" style={{ fontSize: 13 }}>
                      <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
                        <tr>
                          <th className="px-3 py-2.5 font-semibold text-gray-600">Strike</th>
                          <th className="px-3 py-2.5 font-semibold text-gray-600 text-right">% Diff</th>
                          <th className="px-3 py-2.5 font-semibold text-gray-600 text-right">OI</th>
                          <th className="px-3 py-2.5 font-semibold text-gray-600 text-right">Volume</th>
                          <th className="px-3 py-2.5 font-semibold text-gray-600 text-right">IV</th>
                          <th className="px-3 py-2.5 font-semibold text-gray-600 text-right">Delta</th>
                          <th className="px-3 py-2.5 font-semibold text-gray-600 text-right">Mid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedPuts.map((p, i) => {
                          const isSelected = selectedPut?.contractSymbol === p.contractSymbol
                          const isAtm = p.strike === atmStrike
                          const d = stockPrice && dte != null
                            ? putDelta(stockPrice, p.strike, dte / 365, p.impliedVolatility)
                            : null
                          const midPrice = ((p.bid ?? 0) + (p.ask ?? 0)) / 2
                          const showPriceLine = stockPrice != null && i > 0
                            && sortedPuts[i - 1].strike > stockPrice
                            && p.strike <= stockPrice

                          return (
                            <>
                              {showPriceLine && (
                                <tr key="__price_line" className="bg-white">
                                  <td className="pl-[2px] pr-3 py-1.5" colSpan={7}>
                                    <div className="flex items-center gap-2">
                                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold flex-shrink-0 ${changePercent >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                                      {curSymbol}{fmt2(stockPrice)}
                                      {changePercent != null && (
                                        <span>{changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%</span>
                                      )}
                                    </span>
                                    <div className="flex-1 border-t border-gray-300" />
                                    </div>
                                  </td>
                                </tr>
                              )}
                              <tr
                                key={p.contractSymbol}
                                ref={isAtm ? atmRowRef : undefined}
                                onClick={() => { setSelectedPut(p); setMidOverride('') }}
                                className={`cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-indigo-50'
                                    : isAtm
                                    ? 'bg-amber-50 hover:bg-amber-200'
                                    : 'hover:bg-gray-200'
                                }`}
                              >
                                <td className={`px-3 py-2 font-semibold ${isSelected ? 'text-indigo-700' : isAtm ? 'text-amber-700' : 'text-gray-900'}`}>
                                  ${fmt2(p.strike)}
                                  {isAtm && (
                                    <span className="ml-1.5 text-xs font-normal text-amber-500">ATM</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  {(() => {
                                    const pct = ((p.strike - stockPrice) / stockPrice) * 100
                                    const color = pct > 0 ? 'text-emerald-600' : pct < 0 ? 'text-red-500' : 'text-gray-400'
                                    return <span className={color}>{pct > 0 ? '+' : ''}{pct.toFixed(2)}%</span>
                                  })()}
                                </td>
                                <td className="px-3 py-2 text-gray-600 text-right tabular-nums">
                                  {(p.openInterest ?? 0).toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-gray-600 text-right tabular-nums">
                                  {(p.volume ?? 0).toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-gray-600 text-right tabular-nums">
                                  {(p.impliedVolatility * 100).toFixed(1)}%
                                </td>
                                <td className="px-3 py-2 text-gray-600 text-right tabular-nums">
                                  {d != null ? d.toFixed(2) : '—'}
                                </td>
                                <td className="px-3 py-2 font-medium text-right tabular-nums text-gray-900">
                                  ${fmt2(midPrice)}
                                </td>
                              </tr>
                            </>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {!selectedPut && (
                    <p className="text-xs text-gray-400 text-center">Click a row to select a strike</p>
                  )}
                </>
              )}
            </div>
          )}

        </div>

        {/* Mid price override */}
        {(hasAll || hasPutAll) && (
          <div className="mt-4">
            <div className="relative flex items-center w-1/2 ml-auto">
              <span className="absolute right-3 top-1/2 -translate-y-1/2 bg-gray-100 text-gray-400 text-xs px-[0.55rem] py-[0.138rem] rounded border border-gray-300 pointer-events-none">Mid price override</span>
              <span className="absolute left-4 text-gray-400 pointer-events-none">$</span>
              <input
                type="number"
                value={midOverride}
                onChange={e => setMidOverride(e.target.value)}
                min="0"
                step="0.01"
                className="w-full rounded-xl border border-gray-300 bg-white pl-7 pr-4 py-3 text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition placeholder:text-gray-300"
              />
            </div>
          </div>
        )}

        {/* ROI result — calls */}
        {hasAll && (
          <div className="mt-4 bg-white rounded-2xl border border-gray-300 px-6 py-5 flex justify-around items-center gap-4 w-fit ml-auto">
            <div className="text-center">
              <p className="text-xs font-semibold text-gray-700 tracking-wide uppercase mb-1">CC ROI (Annulized)</p>
              <p className="text-4xl font-bold text-gray-900">{roi != null ? fmt2(roi * 100) + '%' : '—'}</p>
            </div>
            <div className="w-px bg-gray-200 self-stretch" />
            <div className="text-center">
              <p className="text-xs font-semibold text-gray-700 tracking-wide uppercase mb-1">CC + Yield</p>
              <p className="text-4xl font-bold text-gray-900">{ccYield != null ? fmt2(ccYield * 100) + '%' : '—'}</p>
            </div>
          </div>
        )}

        {/* ROI result — puts */}
        {hasPutAll && (
          <div className="mt-4 bg-white rounded-2xl border border-gray-300 px-6 py-5 flex justify-around items-center gap-4 w-fit ml-auto">
            <div className="text-center">
              <p className="text-xs font-semibold text-gray-700 tracking-wide uppercase mb-1">Secure Put Return (Annualized)</p>
              <p className="text-4xl font-bold text-gray-900">{securePutReturn != null ? fmt2(securePutReturn * 100) + '%' : '—'}</p>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
