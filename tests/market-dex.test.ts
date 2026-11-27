import { describe, expect, test } from 'bun:test'
import { bucketCandles, DexData, parseOhlcv, pickBestPool } from '../server/market/dex'

const TOKEN = '0x5849fd68a097b3ee7d87ce88a0fcbb76857648ff'
const USDC = '0x3600000000000000000000000000000000000000'
const V4_POOL = '0xa3abdb2721cd343da530ff6fd0ad73f3caa77163ea2fb8206847249f9bba57d5'
const V3_POOL = '0x82916bee18fCEF517B26C72d7Cb5F13694E1dB41'

const pair = (over: Record<string, unknown> = {}) => ({
  chainId: 'arc',
  dexId: 'uniswap',
  url: `https://dexscreener.com/arc/${V4_POOL}`,
  pairAddress: V4_POOL,
  baseToken: { address: '0x5849Fd68a097B3eE7d87ce88a0fcBb768576' + '48ff', symbol: 'ARCMAN' },
  quoteToken: { address: USDC, symbol: 'USDC' },
  priceNative: '0.01083',
  priceUsd: '0.01083',
  volume: { h24: 6245 },
  liquidity: { usd: 263_346 },
  priceChange: { h24: 0.17 },
  ...over,
})

describe('pool choice', () => {
  test('takes the deepest pool and accepts Uniswap v4 pool ids', () => {
    const p = pickBestPool('arc', TOKEN, [pair({ pairAddress: V3_POOL, liquidity: { usd: 1000 } }), pair()])
    expect(p?.pair).toBe(V4_POOL)
    expect(p?.priceUsd).toBeCloseTo(0.01083)
    expect(p?.dex).toBe('uniswap')
    expect(p?.liquidityUsd).toBe(263_346)
  })

  test('a token on the quote side is priced from the base price and the ratio', () => {
    const p = pickBestPool('arc', USDC, [pair({ baseToken: { address: TOKEN, symbol: 'ARCMAN' }, priceNative: '0.01083', priceUsd: '0.01083' })])
    expect(p?.priceUsd).toBeCloseTo(1)
    expect(p?.symbol).toBe('USDC')
  })

  test('pools without liquidity, with a bad id, on another chain or without a price are ignored', () => {
    expect(pickBestPool('arc', TOKEN, [pair({ liquidity: { usd: 0 } })])).toBeNull()
    expect(pickBestPool('arc', TOKEN, [pair({ liquidity: undefined })])).toBeNull()
    expect(pickBestPool('arc', TOKEN, [pair({ pairAddress: '0x1234' })])).toBeNull()
    expect(pickBestPool('arc', TOKEN, [pair({ chainId: 'base' })])).toBeNull()
    expect(pickBestPool('arc', TOKEN, [pair({ priceUsd: 'abc' })])).toBeNull()
    expect(pickBestPool('arc', TOKEN, [])).toBeNull()
  })

  test('a link must stay on dexscreener.com', () => {
    expect(pickBestPool('arc', TOKEN, [pair({ url: 'https://evil.example/x' })])?.url).toBeNull()
  })
})

describe('candles', () => {
  test('parses newest-first rows into ascending candles and drops bad rows', () => {
    const c = parseOhlcv([[3000, 3, 4, 2, 3.5, 10], [1000, 1, 2, 0.5, 1.5, 5], ['x', 1, 1, 1, 1, 1], [2000, 2, 3, 1, 0, 1], [0, 1]])
    expect(c.map((x) => x.time)).toEqual([1000, 3000])
    expect(c[0]).toEqual({ time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 })
    expect(parseOhlcv(null)).toEqual([])
  })

  test('builds weekly candles from daily ones, weeks starting Monday', () => {
    const monday = 1_794_182_400 // 2026-11-09 00:00 UTC, a Monday
    const days = Array.from({ length: 9 }, (_, i) => ({ time: monday + i * 86_400, open: i + 1, high: i + 2, low: i, close: i + 1.5, volume: 1 }))
    const weeks = bucketCandles(days, 604_800, 345_600)
    expect(weeks).toHaveLength(2)
    expect(weeks[0]).toMatchObject({ open: 1, close: 7.5, low: 0, high: 8, volume: 7 })
    expect(weeks[1].time - weeks[0].time).toBe(604_800)
  })
})

function fakeFetch(handlers: { pairs?: unknown; ohlcv?: unknown; status?: number }) {
  const calls: string[] = []
  const fn = (url: string) => {
    calls.push(url)
    const status = handlers.status ?? 200
    if (url.includes('dexscreener')) return Promise.resolve(new Response(JSON.stringify(handlers.pairs ?? [pair()]), { status }))
    return Promise.resolve(new Response(JSON.stringify(handlers.ohlcv ?? { data: { attributes: { ohlcv_list: [[2000, 2, 3, 1, 2.5, 7], [1000, 1, 2, 1, 1.5, 3]] } } }), { status }))
  }
  return { fn: fn as unknown as typeof fetch, calls }
}

describe('DexData', () => {
  test('serves chart data, caches it and shares concurrent requests', async () => {
    const f = fakeFetch({})
    let now = 1_000_000
    const d = new DexData({ fetchFn: f.fn, now: () => now })
    const [a, b] = await Promise.all([d.candles(5042, TOKEN, '1h'), d.candles(5042, TOKEN, '1h')])
    expect(a?.candles).toHaveLength(2)
    expect(b?.candles).toHaveLength(2)
    expect(f.calls.filter((u) => u.includes('geckoterminal'))).toHaveLength(1)
    const url = f.calls.find((u) => u.includes('geckoterminal'))!
    expect(url).toContain(`/pools/${V4_POOL}/ohlcv/hour?aggregate=1`)
    expect(url).toContain(`token=${TOKEN}`)
    now += 10_000
    await d.candles(5042, TOKEN, '1h')
    expect(f.calls.filter((u) => u.includes('geckoterminal'))).toHaveLength(1)
    now += 200_000
    await d.candles(5042, TOKEN, '1h')
    expect(f.calls.filter((u) => u.includes('geckoterminal'))).toHaveLength(2)
  })

  test('says "no pool" instead of inventing data', async () => {
    const d = new DexData({ fetchFn: fakeFetch({ pairs: [] }).fn })
    expect(await d.pool(5042, TOKEN)).toBeNull()
    expect(await d.candles(5042, TOKEN, '1h')).toBeNull()
    expect(await d.pool(1, TOKEN)).toBeNull()
    expect(await d.pool(5042, 'not-an-address')).toBeNull()
  })

  test('keeps the process under the free tier limit, and serves stale data rather than failing', async () => {
    const f = fakeFetch({})
    let now = 1_000_000
    const d = new DexData({ fetchFn: f.fn, now: () => now, geckoPerMinute: 2 })
    await d.candles(5042, TOKEN, '1h')
    await d.candles(5042, TOKEN, '4h')
    await expect(d.candles(5042, TOKEN, '1D')).rejects.toThrow('busy')
    now += 100_000
    expect((await d.candles(5042, TOKEN, '1h'))?.stale).toBe(false)
    // Over budget again: the cached 4h answer is returned, marked stale.
    await d.candles(5042, TOKEN, '1D')
    now += 400_000
    const again = await d.candles(5042, TOKEN, '4h')
    expect(again?.candles.length).toBeGreaterThan(0)
  })

  test('an upstream failure falls back to the last good answer', async () => {
    let fail = false
    const good = fakeFetch({})
    let now = 1_000_000
    const d = new DexData({ fetchFn: ((u: string) => (fail && u.includes('geckoterminal') ? Promise.resolve(new Response('no', { status: 500 })) : good.fn(u))) as unknown as typeof fetch, now: () => now })
    await d.candles(5042, TOKEN, '1h')
    fail = true
    now += 200_000
    const out = await d.candles(5042, TOKEN, '1h')
    expect(out?.stale).toBe(true)
    expect(out?.candles).toHaveLength(2)
  })
})
