/**
 * Reference market data from Coinbase Exchange public endpoints (REST + WebSocket).
 * This is a CEX reference price for the underlying asset, not an Arc pool price.
 * Nothing here is generated locally: if a request fails the caller gets an error.
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1D' | '1W'

export interface Candle {
  /** Unix seconds, bucket start. */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface TimeframeSpec {
  id: Timeframe
  /** Native Coinbase granularity in seconds. */
  granularity: 60 | 300 | 900 | 3600 | 86400
  /** Bucket size in seconds; larger than granularity means aggregation. */
  bucket: number
  /** Offset so weekly buckets start on Monday 00:00 UTC. */
  offset: number
}

export const TIMEFRAMES: TimeframeSpec[] = [
  { id: '1m', granularity: 60, bucket: 60, offset: 0 },
  { id: '5m', granularity: 300, bucket: 300, offset: 0 },
  { id: '15m', granularity: 900, bucket: 900, offset: 0 },
  { id: '1h', granularity: 3600, bucket: 3600, offset: 0 },
  { id: '4h', granularity: 3600, bucket: 14400, offset: 0 },
  { id: '1D', granularity: 86400, bucket: 86400, offset: 0 },
  { id: '1W', granularity: 86400, bucket: 604800, offset: 345600 },
]

const REST = 'https://api.exchange.coinbase.com'
const WS = 'wss://ws-feed.exchange.coinbase.com'

export function specFor(tf: Timeframe): TimeframeSpec {
  return TIMEFRAMES.find((t) => t.id === tf) ?? TIMEFRAMES[3]
}

/** Groups finer candles into `bucket`-second candles. Input must be ascending by time. */
export function aggregateCandles(candles: Candle[], bucket: number, offset = 0): Candle[] {
  const out: Candle[] = []
  for (const c of candles) {
    const start = Math.floor((c.time - offset) / bucket) * bucket + offset
    const last = out[out.length - 1]
    if (last && last.time === start) {
      last.high = Math.max(last.high, c.high)
      last.low = Math.min(last.low, c.low)
      last.close = c.close
      last.volume += c.volume
    } else {
      out.push({ ...c, time: start })
    }
  }
  return out
}

export async function fetchCandles(product: string, tf: Timeframe, pages = 3): Promise<Candle[]> {
  const spec = specFor(tf)
  const window = spec.granularity * 300
  const all = new Map<number, Candle>()
  let end = Math.floor(Date.now() / 1000)
  for (let i = 0; i < pages; i++) {
    const start = end - window
    const url = `${REST}/products/${encodeURIComponent(product)}/candles?granularity=${spec.granularity}&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Market data request failed (${res.status})`)
    const rows = (await res.json()) as number[][]
    for (const [time, low, high, open, close, volume] of rows) {
      all.set(time, { time, open, high, low, close, volume })
    }
    end = start
  }
  const sorted = [...all.values()].sort((a, b) => a.time - b.time)
  return spec.bucket === spec.granularity ? sorted : aggregateCandles(sorted, spec.bucket, spec.offset)
}

export interface Stats {
  open: number
  high: number
  low: number
  last: number
  volume: number
  changePct: number
}

export async function fetchStats(product: string): Promise<Stats> {
  const res = await fetch(`${REST}/products/${encodeURIComponent(product)}/stats`)
  if (!res.ok) throw new Error(`Market stats request failed (${res.status})`)
  const j = (await res.json()) as { open: string; high: string; low: string; last: string; volume: string }
  const open = Number(j.open)
  const last = Number(j.last)
  return {
    open,
    high: Number(j.high),
    low: Number(j.low),
    last,
    volume: Number(j.volume),
    changePct: open > 0 ? (last - open) / open : 0,
  }
}

export function sma(candles: Candle[], period: number): { time: number; value: number }[] {
  const out: { time: number; value: number }[] = []
  let sum = 0
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close
    if (i >= period) sum -= candles[i - period].close
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period })
  }
  return out
}

export function ema(candles: Candle[], period: number): { time: number; value: number }[] {
  const k = 2 / (period + 1)
  const out: { time: number; value: number }[] = []
  let prev: number | undefined
  for (const c of candles) {
    prev = prev === undefined ? c.close : c.close * k + prev * (1 - k)
    out.push({ time: c.time, value: prev })
  }
  return out.slice(period - 1)
}

/** Where a pool price comes from: the deepest DEX pool for a token the aggregator can route. */
export interface PoolInfo {
  dex: string
  pair: string
  symbol: string
  quoteSymbol: string
  priceUsd: number
  change24hPct: number | null
  volume24hUsd: number
  liquidityUsd: number
  url: string | null
}

export interface MarketState {
  candles: Candle[]
  last: number | null
  stats: Stats | null
  loading: boolean
  error: string | null
  live: boolean
  /** 'cex' is a Coinbase reference price; 'dex' is a real Arc pool. */
  kind: 'cex' | 'dex' | null
  pool: PoolInfo | null
  /** The pool answered that the token has no pool with liquidity. */
  noPool: boolean
}

const EMPTY: MarketState = { candles: [], last: null, stats: null, loading: false, error: null, live: false, kind: null, pool: null, noPool: false }

/** Loads history, then keeps the newest candle moving with the live ticker. */
export function useMarket(product: string | undefined, tf: Timeframe): MarketState {
  const key = product ? `${product}:${tf}` : ''
  const [loaded, setLoaded] = useState<{ key: string; state: MarketState }>({ key: '', state: EMPTY })
  const candlesRef = useRef<Candle[]>([])

  useEffect(() => {
    if (!product) return
    const ctl = { cancelled: false }
    let ws: WebSocket | null = null
    let flush: ReturnType<typeof setTimeout> | undefined
    const spec = specFor(tf)
    const k = `${product}:${tf}`

    Promise.all([fetchCandles(product, tf), fetchStats(product)])
      .then(([candles, stats]) => {
        if (ctl.cancelled) return
        candlesRef.current = candles
        const lastCandle = candles[candles.length - 1]
        setLoaded({ key: k, state: { ...EMPTY, kind: 'cex', candles, last: lastCandle ? lastCandle.close : stats.last, stats } })
        ws = new WebSocket(WS)
        ws.onopen = () => ws?.send(JSON.stringify({ type: 'subscribe', product_ids: [product], channels: ['ticker'] }))
        ws.onmessage = (ev) => {
          const m = JSON.parse(String(ev.data)) as { type: string; price?: string; time?: string }
          if (m.type !== 'ticker' || !m.price || !m.time) return
          const price = Number(m.price)
          const t = Math.floor(new Date(m.time).getTime() / 1000)
          const start = Math.floor((t - spec.offset) / spec.bucket) * spec.bucket + spec.offset
          const list = candlesRef.current
          const lastC = list[list.length - 1]
          if (lastC && lastC.time === start) {
            lastC.close = price
            lastC.high = Math.max(lastC.high, price)
            lastC.low = Math.min(lastC.low, price)
          } else if (!lastC || start > lastC.time) {
            list.push({ time: start, open: price, high: price, low: price, close: price, volume: 0 })
          }
          clearTimeout(flush)
          flush = setTimeout(() => {
            if (!ctl.cancelled) setLoaded((cur) => ({ key: cur.key, state: { ...cur.state, candles: [...candlesRef.current], last: price, live: true } }))
          }, 250)
        }
      })
      .catch((e: unknown) => {
        if (!ctl.cancelled) setLoaded({ key: k, state: { ...EMPTY, kind: 'cex', error: e instanceof Error ? e.message : 'Market data unavailable' } })
      })

    return () => {
      ctl.cancelled = true
      clearTimeout(flush)
      ws?.close()
    }
  }, [product, tf])

  if (!product) return EMPTY
  if (loaded.key !== key) return { ...EMPTY, kind: 'cex', loading: true }
  return loaded.state
}

interface DexCandlesResponse {
  market: (PoolInfo & { token: string }) | null
  candles?: Candle[]
  stale?: boolean
  reason?: string
  error?: { message?: string }
}

/** Chart decimals that keep small prices readable: 0.0001462 must not render as 0.00. */
export function priceDecimals(price: number | null): number {
  if (price === null || !(price > 0)) return 2
  if (price >= 1000) return 2
  if (price >= 1) return 4
  if (price >= 0.01) return 5
  if (price >= 0.0001) return 7
  return 9
}

/**
 * Pool data for any token without a Coinbase market: price, 24h numbers and candles from the token's deepest pool
 * on the chain, through the backend (DexScreener and GeckoTerminal, free, cached). It polls, because the sources
 * have no push feed. Disabled for tokens that already have a Coinbase reference.
 */
export function useDexMarket(chainId: number, token: string | undefined, tf: Timeframe, enabled: boolean): MarketState {
  const q = useQuery({
    queryKey: ['dex-market', chainId, token?.toLowerCase(), tf],
    enabled: enabled && Boolean(token),
    refetchInterval: tf === '1m' || tf === '5m' ? 20_000 : 45_000,
    staleTime: 10_000,
    retry: 1,
    queryFn: async (): Promise<DexCandlesResponse> => {
      const res = await fetch(`/api/market/candles?chainId=${chainId}&token=${token}&tf=${tf}`)
      const body = (await res.json().catch(() => ({}))) as DexCandlesResponse
      if (!res.ok) throw new Error(body.error?.message ?? 'Chart data is temporarily unavailable')
      return body
    },
  })
  if (!enabled || !token) return EMPTY
  if (q.isLoading) return { ...EMPTY, kind: 'dex', loading: true }
  if (q.isError && !q.data) return { ...EMPTY, kind: 'dex', error: q.error instanceof Error ? q.error.message : 'Chart data is temporarily unavailable' }
  const d = q.data
  if (!d || !d.market) return { ...EMPTY, kind: 'dex', noPool: true }
  const candles = d.candles ?? []
  const last = d.market.priceUsd
  // The time of the last fetch stands in for "now", which keeps this render pure.
  const dayAgo = q.dataUpdatedAt / 1000 - 86_400
  const recent = candles.filter((c) => c.time >= dayAgo)
  const window = recent.length ? recent : candles
  const stats: Stats = {
    open: last / (1 + (d.market.change24hPct ?? 0) / 100),
    high: window.length ? Math.max(...window.map((c) => c.high), last) : last,
    low: window.length ? Math.min(...window.map((c) => c.low), last) : last,
    last,
    volume: d.market.volume24hUsd,
    changePct: (d.market.change24hPct ?? 0) / 100,
  }
  return { candles, last, stats, loading: false, error: null, live: !d.stale, kind: 'dex', pool: d.market, noPool: false }
}
