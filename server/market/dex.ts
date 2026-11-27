/**
 * Price and chart data for any token the aggregator can route on Arc, from two free public APIs that need no key:
 *   - DexScreener  (api.dexscreener.com)   which pools exist, price, 24h change, volume and liquidity
 *   - GeckoTerminal (api.geckoterminal.com) OHLCV candles for a pool
 *
 * Coinbase only lists a handful of assets (BTC, ETH, EURC), so every other token on the picker used to have no chart.
 * This module finds the token's deepest pool and serves its candles, so each listed token has a real chart and price.
 *
 * The free tiers are small (GeckoTerminal allows about 30 calls a minute), so everything here is cached, concurrent
 * identical requests share one upstream call, a request budget keeps the process under the limit, and when an upstream
 * fails the last good answer is served instead of an error. Nothing is invented: when no pool has liquidity the caller
 * gets "no market".
 */

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1D' | '1W'

export interface DexCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface DexPool {
  chain: string
  pair: string
  dex: string
  /** The token this answer is about, lower-case. */
  token: string
  symbol: string
  quoteSymbol: string
  /** USD price of `token`. */
  priceUsd: number
  change24hPct: number | null
  volume24hUsd: number
  liquidityUsd: number
  url: string | null
}

export const CHAIN_SLUGS: Readonly<Record<number, string>> = { 5042: 'arc' }

const DEXSCREENER = 'https://api.dexscreener.com'
const GECKO = 'https://api.geckoterminal.com/api/v2'
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
/** A pool is a 20-byte contract address, or a 32-byte pool id for Uniswap v4. */
const POOL_RE = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

interface RawPair {
  chainId?: string
  dexId?: string
  url?: string
  pairAddress?: string
  baseToken?: { address?: string; symbol?: string }
  quoteToken?: { address?: string; symbol?: string }
  priceNative?: string
  priceUsd?: string
  volume?: { h24?: number }
  liquidity?: { usd?: number }
  priceChange?: { h24?: number }
}

/** The pool with the most liquidity that has a usable USD price for this token. Pure, for tests. */
export function pickBestPool(chain: string, token: string, pairs: RawPair[]): DexPool | null {
  const t = token.toLowerCase()
  let best: DexPool | null = null
  for (const p of pairs) {
    if (p.chainId && p.chainId !== chain) continue
    const base = p.baseToken?.address?.toLowerCase()
    const quote = p.quoteToken?.address?.toLowerCase()
    if (!p.pairAddress || !POOL_RE.test(p.pairAddress)) continue
    const liquidity = Number(p.liquidity?.usd ?? 0)
    if (!(liquidity > 0)) continue
    let priceUsd: number
    let symbol: string
    let quoteSymbol: string
    if (base === t) {
      priceUsd = Number(p.priceUsd)
      symbol = p.baseToken?.symbol ?? ''
      quoteSymbol = p.quoteToken?.symbol ?? ''
    } else if (quote === t) {
      // The token is the quote side: its price is the base's USD price divided by the base's price in this token.
      const usd = Number(p.priceUsd)
      const native = Number(p.priceNative)
      priceUsd = native > 0 ? usd / native : NaN
      symbol = p.quoteToken?.symbol ?? ''
      quoteSymbol = p.baseToken?.symbol ?? ''
    } else continue
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue
    if (best && best.liquidityUsd >= liquidity) continue
    best = {
      chain,
      pair: p.pairAddress,
      dex: String(p.dexId ?? 'dex').slice(0, 24),
      token: t,
      symbol: symbol.slice(0, 16),
      quoteSymbol: quoteSymbol.slice(0, 16),
      priceUsd,
      change24hPct: typeof p.priceChange?.h24 === 'number' ? p.priceChange.h24 : null,
      volume24hUsd: Number(p.volume?.h24 ?? 0) || 0,
      liquidityUsd: liquidity,
      url: typeof p.url === 'string' && p.url.startsWith('https://dexscreener.com/') ? p.url : null,
    }
  }
  return best
}

interface GeckoSpec {
  unit: 'minute' | 'hour' | 'day'
  aggregate: number
  /** Seconds per returned bar. */
  step: number
  /** When the timeframe is built from finer bars, the bucket in seconds. */
  bucket?: number
  ttlMs: number
}

const SPECS: Record<Timeframe, GeckoSpec> = {
  '1m': { unit: 'minute', aggregate: 1, step: 60, ttlMs: 20_000 },
  '5m': { unit: 'minute', aggregate: 5, step: 300, ttlMs: 30_000 },
  '15m': { unit: 'minute', aggregate: 15, step: 900, ttlMs: 45_000 },
  '1h': { unit: 'hour', aggregate: 1, step: 3600, ttlMs: 90_000 },
  '4h': { unit: 'hour', aggregate: 4, step: 14_400, ttlMs: 180_000 },
  '1D': { unit: 'day', aggregate: 1, step: 86_400, ttlMs: 600_000 },
  // GeckoTerminal has no weekly bars: they are built from daily bars (weeks start Monday 00:00 UTC).
  '1W': { unit: 'day', aggregate: 1, step: 86_400, bucket: 604_800, ttlMs: 900_000 },
}

export const TIMEFRAME_IDS = Object.keys(SPECS) as Timeframe[]

/** Parses a GeckoTerminal `ohlcv_list` (newest first) into ascending candles. Bad rows are dropped. */
export function parseOhlcv(list: unknown): DexCandle[] {
  if (!Array.isArray(list)) return []
  const out: DexCandle[] = []
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue
    const [time, open, high, low, close, volume] = row.map(Number)
    if (![time, open, high, low, close].every(Number.isFinite) || !(close > 0)) continue
    out.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 })
  }
  return out.sort((a, b) => a.time - b.time)
}

/** Groups finer candles into `bucket`-second ones, weeks starting on Monday. Input ascending. */
export function bucketCandles(candles: DexCandle[], bucket: number, offset = 0): DexCandle[] {
  const out: DexCandle[] = []
  for (const c of candles) {
    const start = Math.floor((c.time - offset) / bucket) * bucket + offset
    const last = out[out.length - 1]
    if (last && last.time === start) {
      last.high = Math.max(last.high, c.high)
      last.low = Math.min(last.low, c.low)
      last.close = c.close
      last.volume += c.volume
    } else out.push({ ...c, time: start })
  }
  return out
}

interface CacheEntry<T> {
  at: number
  value: T
}

export interface DexDataOptions {
  fetchFn?: Fetch
  now?: () => number
  /** GeckoTerminal calls per minute this process may make. The public limit is about 30. */
  geckoPerMinute?: number
  poolTtlMs?: number
}

export class DexData {
  private pools = new Map<string, CacheEntry<DexPool | null>>()
  private candleCache = new Map<string, CacheEntry<DexCandle[]>>()
  private inflight = new Map<string, Promise<unknown>>()
  private geckoCalls: number[] = []
  private readonly doFetch: Fetch
  private readonly now: () => number
  private readonly geckoPerMinute: number
  private readonly poolTtl: number

  constructor(opts: DexDataOptions = {}) {
    this.doFetch = opts.fetchFn ?? ((input, init) => fetch(input, init))
    this.now = opts.now ?? (() => Date.now())
    this.geckoPerMinute = Math.max(1, opts.geckoPerMinute ?? 24)
    this.poolTtl = opts.poolTtlMs ?? 60_000
  }

  supports(chainId: number): boolean {
    return chainId in CHAIN_SLUGS
  }

  private share<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.inflight.get(key) as Promise<T> | undefined
    if (hit) return hit
    const p = load().finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }

  private geckoAllowed(): boolean {
    const t = this.now()
    this.geckoCalls = this.geckoCalls.filter((x) => t - x < 60_000)
    if (this.geckoCalls.length >= this.geckoPerMinute) return false
    this.geckoCalls.push(t)
    return true
  }

  /** Deepest pool and market numbers for a token. `null` means no pool with liquidity exists. */
  async pool(chainId: number, token: string): Promise<DexPool | null> {
    const chain = CHAIN_SLUGS[chainId]
    if (!chain || !ADDRESS_RE.test(token)) return null
    const key = `${chain}:${token.toLowerCase()}`
    const hit = this.pools.get(key)
    if (hit && this.now() - hit.at < this.poolTtl) return hit.value
    try {
      const value = await this.share(`pool:${key}`, async () => {
        const res = await this.doFetch(`${DEXSCREENER}/tokens/v1/${chain}/${token}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
        if (!res.ok) throw new Error(`dexscreener answered ${res.status}`)
        const body = (await res.json()) as unknown
        return pickBestPool(chain, token, Array.isArray(body) ? (body as RawPair[]) : [])
      })
      this.pools.set(key, { at: this.now(), value })
      if (this.pools.size > 2000) this.pools.delete(this.pools.keys().next().value as string)
      return value
    } catch (e) {
      if (hit) return hit.value
      throw e
    }
  }

  /** Candles for a token's deepest pool, priced in USD. Served from cache, or stale cache when the upstream fails. */
  async candles(chainId: number, token: string, tf: Timeframe): Promise<{ pool: DexPool; candles: DexCandle[]; stale: boolean } | null> {
    const pool = await this.pool(chainId, token)
    if (!pool) return null
    const spec = SPECS[tf]
    const key = `${pool.pair}:${token.toLowerCase()}:${tf}`
    const hit = this.candleCache.get(key)
    if (hit && this.now() - hit.at < spec.ttlMs) return { pool, candles: hit.value, stale: false }
    if (!this.geckoAllowed()) {
      if (hit) return { pool, candles: hit.value, stale: true }
      throw new Error('The chart service is busy. Try again in a moment.')
    }
    try {
      const candles = await this.share(`ohlcv:${key}`, async () => {
        const limit = spec.bucket ? 600 : 300
        const url = `${GECKO}/networks/${pool.chain}/pools/${pool.pair}/ohlcv/${spec.unit}?aggregate=${spec.aggregate}&limit=${limit}&currency=usd&token=${token.toLowerCase()}`
        const res = await this.doFetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
        if (!res.ok) throw new Error(`geckoterminal answered ${res.status}`)
        const json = (await res.json()) as { data?: { attributes?: { ohlcv_list?: unknown } } }
        const raw = parseOhlcv(json.data?.attributes?.ohlcv_list)
        return spec.bucket ? bucketCandles(raw, spec.bucket, 345_600) : raw
      })
      this.candleCache.set(key, { at: this.now(), value: candles })
      if (this.candleCache.size > 4000) this.candleCache.delete(this.candleCache.keys().next().value as string)
      return { pool, candles, stale: false }
    } catch (e) {
      if (hit) return { pool, candles: hit.value, stale: true }
      throw e
    }
  }
}
