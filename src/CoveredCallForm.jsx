import { useState, useEffect, useRef } from 'react'
import { fetchStockPrice } from './utils/fetchStockPrice'
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
  const [refreshKey, setRefreshKey] = useState(0)

  function commitTicker(raw) {
    const sym = raw.trim().toUpperCase()
    setTickerInput(sym)
    setTicker(sym)
  }
  const atmRowRef = useRef(null)

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
      setCalls([])
      setSelectedCall(null)

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
  }, [ticker, selectedExpiry])

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

  const mid = selectedCall ? ((selectedCall.bid ?? 0) + (selectedCall.ask ?? 0)) / 2 : null
  const roi = mid != null && dte > 0 ? ((mid / dte) * 365) / stockPrice : null
  const ccYield = roi != null && dte > 0 ? (dividendYield / 365 * dte) + roi : null

  const putMid = selectedPut ? ((selectedPut.bid ?? 0) + (selectedPut.ask ?? 0)) / 2 : null
  const securePutReturn = putMid != null && dte > 0 ? (putMid / selectedPut.strike / dte) * 365 : null
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
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex flex-col gap-6">

          {/* Recent tickers */}
          {tickerHistory.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tickerHistory.map(t => (
                <button
                  key={t}
                  onClick={() => commitTicker(t)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
                    ticker === t
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200'
                  }`}
                >
                  {t}
                </button>
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
            <div className="relative flex items-center">
              <input
                type="text"
                value={tickerInput}
                onChange={e => {
                  const val = e.target.value.toUpperCase()
                  setTickerInput(val)
                  if (val === '') setTicker('')
                }}
                onKeyDown={e => { if (e.key === 'Enter') commitTicker(tickerInput) }}
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
              {stockPrice !== null && fetchState === 'idle' && (
                <span className="absolute right-3">
                  <Badge color="green">✓ {curSymbol}{fmt2(stockPrice)}</Badge>
                </span>
              )}
            </div>
            {tickerName && (
              <p className="text-2xl font-medium text-gray-500 mt-8">{tickerName}</p>
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
                <button
                  onClick={() => setRefreshKey(k => k + 1)}
                  disabled={isRefreshing}
                  title="Refresh"
                  className="text-gray-400 hover:text-indigo-500 disabled:opacity-40 transition-colors"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
                  >
                    <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H5.498a.75.75 0 00-.75.75v3.212a.75.75 0 001.5 0v-1.73l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V3.928a.75.75 0 00-1.5 0v1.73l-.31-.31A7 7 0 003.239 8.485a.75.75 0 101.449.39A5.5 5.5 0 0113.89 6.11l.311.31h-2.432a.75.75 0 000 1.5h3.574a.75.75 0 00.53-.219z" clipRule="evenodd" />
                  </svg>
                </button>
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
                                onClick={() => setSelectedCall(c)}
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
                                onClick={() => setSelectedPut(p)}
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

        {/* ROI result — calls */}
        {hasAll && (
          <div className="mt-4 bg-white rounded-2xl shadow-sm border border-gray-200 px-6 py-5 flex justify-around items-center gap-4">
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
          <div className="mt-4 bg-white rounded-2xl shadow-sm border border-gray-200 px-6 py-5 flex justify-around items-center gap-4">
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
