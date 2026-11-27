/**
 * Numbers for the platform dashboard, derived only from what the indexer already stored: contract events and the
 * market swaps users reported (each of those re-checked against the chain before it was saved).
 *
 * Everything is measured in USDC, the quote token of every order. The USDC leg of a trade is:
 *   buy order or DCA buy   the amount spent (amountIn)
 *   sell order             the USDC received (net + keeper fee)
 *   market swap            the sell amount when USDC was sold, the buy amount when USDC was bought
 * A swap between two other tokens has no USDC leg and is counted but not valued. Nothing is guessed or priced from outside.
 *
 * Fees:
 *   market swap fee   estimated as the current fee rate on swaps that sold USDC. It is an estimate: the aggregator
 *                     pays the real amount straight to the fee wallet, whose live balance the dashboard also shows.
 *   keeper fee        comes out of what the order bought. It is USDC only for sell orders, and goes to whoever ran
 *                     the keeper, not to the fee wallet.
 */
import { USDC_DECIMALS } from '../src/onchain-facts'

export interface EventLite {
  name: string
  owner: string | null
  itemId: string | null
  blockTime: number
  txHash: string
  args: Record<string, unknown>
}

export interface SwapLite {
  owner: string
  txHash: string
  sellToken: string
  sellAmount: string
  buyToken: string
  buyAmount: string
  blockTime: number
}

export interface UserStat {
  address: string
  orders: number
  filled: number
  dcaPlans: number
  dcaRuns: number
  swaps: number
  volumeUnits: string
  firstSeen: number
  lastSeen: number
}

export interface DayPoint {
  date: string
  orderUnits: string
  dcaUnits: string
  swapUnits: string
  totalUnits: string
  trades: number
}

export interface ActivityItem {
  kind: 'order_created' | 'order_filled' | 'dca_created' | 'dca_run' | 'swap'
  owner: string | null
  txHash: string
  time: number
  usdcUnits: string | null
}

export interface PlatformStats {
  decimals: number
  users: { total: number; active7d: number; new7d: number }
  orders: { created: number; filled: number; cancelled: number; expired: number; open: number; byType: Record<string, number> }
  dca: { plans: number; runs: number; active: number }
  swaps: { count: number; valued: number }
  volumeUnits: { total: string; orders: string; dca: string; swaps: string }
  fees: {
    swapFeeBps: number | null
    swapFeeEstimateUnits: string
    swapsFeeNotValued: number
    keeperFeeUsdcUnits: string
    keeperFeeOtherTokenCount: number
  }
  days: DayPoint[]
  topUsers: UserStat[]
  recent: ActivityItem[]
}

const ORDER_TYPES = ['Limit', 'Stop loss', 'Take profit', 'Stop limit', 'Trailing stop', 'OCO']

const big = (v: unknown): bigint => {
  try {
    return typeof v === 'bigint' ? v : BigInt(typeof v === 'number' ? Math.trunc(v) : String(v ?? '0'))
  } catch {
    return 0n
  }
}

const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)

interface Acc {
  address: string
  orders: number
  filled: number
  dcaPlans: number
  dcaRuns: number
  swaps: number
  volume: bigint
  firstSeen: number
  lastSeen: number
}

export function computePlatformStats(
  events: readonly EventLite[],
  swaps: readonly SwapLite[],
  opts: { usdc: string; feeBps: number | null; nowSec: number; days: number; topUsers: number },
): PlatformStats {
  const usdc = opts.usdc.toLowerCase()
  // A chain clock a little ahead of this machine's must not push recent trades out of the window.
  let latest = opts.nowSec
  for (const e of events) if (e.blockTime > latest) latest = e.blockTime
  for (const s of swaps) if (s.blockTime > latest) latest = s.blockTime
  const nowSec = latest
  const users = new Map<string, Acc>()
  const touch = (address: string | null, t: number): Acc | null => {
    if (!address) return null
    const a = address.toLowerCase()
    let u = users.get(a)
    if (!u) {
      u = { address: a, orders: 0, filled: 0, dcaPlans: 0, dcaRuns: 0, swaps: 0, volume: 0n, firstSeen: t, lastSeen: t }
      users.set(a, u)
    }
    if (t < u.firstSeen) u.firstSeen = t
    if (t > u.lastSeen) u.lastSeen = t
    return u
  }

  // Which side each order is on decides which leg is USDC. Created events come before executions in time, not in row order.
  const sideOf = new Map<string, number>()
  for (const e of events) {
    if (e.name !== 'OrderCreated' || e.itemId === null) continue
    const side = num((e.args.params as { side?: unknown } | undefined)?.side)
    if (side !== null) sideOf.set(e.itemId, side)
  }

  const dayStart = nowSec - (nowSec % 86_400) - (opts.days - 1) * 86_400
  const series = new Map<string, { order: bigint; dca: bigint; swap: bigint; trades: number }>()
  for (let i = 0; i < opts.days; i++) series.set(dayOf(dayStart + i * 86_400), { order: 0n, dca: 0n, swap: 0n, trades: 0 })
  const bump = (t: number, kind: 'order' | 'dca' | 'swap', units: bigint) => {
    const d = series.get(dayOf(t))
    if (!d) return
    d[kind] += units
    d.trades += 1
  }

  const orders = { created: 0, filled: 0, cancelled: 0, expired: 0, open: 0, byType: {} as Record<string, number> }
  const dca = { plans: 0, runs: 0, active: 0 }
  let dcaCancelled = 0
  let dcaCompleted = 0
  let orderVol = 0n
  let dcaVol = 0n
  let swapVol = 0n
  let keeperUsdc = 0n
  let keeperOther = 0
  const recent: ActivityItem[] = []
  const note = (item: ActivityItem) => recent.push(item)

  for (const e of events) {
    const u = touch(e.owner, e.blockTime)
    switch (e.name) {
      case 'OrderCreated': {
        orders.created += 1
        if (u) u.orders += 1
        const t = num((e.args.params as { orderType?: unknown } | undefined)?.orderType)
        const label = t !== null && ORDER_TYPES[t] ? ORDER_TYPES[t] : 'Other'
        orders.byType[label] = (orders.byType[label] ?? 0) + 1
        note({ kind: 'order_created', owner: e.owner, txHash: e.txHash, time: e.blockTime, usdcUnits: null })
        break
      }
      case 'OrderExecuted': {
        orders.filled += 1
        if (u) u.filled += 1
        const side = e.itemId === null ? undefined : sideOf.get(e.itemId)
        const fee = big(e.args.keeperFee)
        let leg: bigint | null = null
        if (side === 0) {
          leg = big(e.args.amountIn)
          keeperOther += fee > 0n ? 1 : 0
        } else if (side === 1) {
          leg = big(e.args.net) + fee
          keeperUsdc += fee
        }
        if (leg !== null) {
          orderVol += leg
          if (u) u.volume += leg
          bump(e.blockTime, 'order', leg)
        }
        note({ kind: 'order_filled', owner: e.owner, txHash: e.txHash, time: e.blockTime, usdcUnits: leg === null ? null : leg.toString() })
        break
      }
      case 'OrderCancelled':
        orders.cancelled += 1
        break
      case 'OrderExpired':
        orders.expired += 1
        break
      case 'DcaCreated':
        dca.plans += 1
        if (u) u.dcaPlans += 1
        note({ kind: 'dca_created', owner: e.owner, txHash: e.txHash, time: e.blockTime, usdcUnits: null })
        break
      case 'DcaExecuted': {
        dca.runs += 1
        if (u) u.dcaRuns += 1
        const leg = big(e.args.amountIn)
        dcaVol += leg
        if (u) u.volume += leg
        if (big(e.args.keeperFee) > 0n) keeperOther += 1
        bump(e.blockTime, 'dca', leg)
        note({ kind: 'dca_run', owner: e.owner, txHash: e.txHash, time: e.blockTime, usdcUnits: leg.toString() })
        break
      }
      case 'DcaCancelled':
        dcaCancelled += 1
        break
      case 'DcaCompleted':
        dcaCompleted += 1
        break
    }
  }

  let swapsValued = 0
  let feeEstimate = 0n
  let feeNotValued = 0
  for (const s of swaps) {
    const u = touch(s.owner, s.blockTime)
    if (u) u.swaps += 1
    let leg: bigint | null = null
    if (s.sellToken.toLowerCase() === usdc) {
      leg = big(s.sellAmount)
      if (opts.feeBps) feeEstimate += (leg * BigInt(opts.feeBps)) / 10_000n
    } else if (s.buyToken.toLowerCase() === usdc) {
      leg = big(s.buyAmount)
    }
    // The fee is taken from what was sold. When that was not USDC the fee is in another token and is not valued here.
    if (opts.feeBps && s.sellToken.toLowerCase() !== usdc) feeNotValued += 1
    if (leg !== null) {
      swapsValued += 1
      swapVol += leg
      if (u) u.volume += leg
      bump(s.blockTime, 'swap', leg)
    }
    note({ kind: 'swap', owner: s.owner, txHash: s.txHash, time: s.blockTime, usdcUnits: leg === null ? null : leg.toString() })
  }

  orders.open = Math.max(0, orders.created - orders.filled - orders.cancelled - orders.expired)
  dca.active = Math.max(0, dca.plans - dcaCancelled - dcaCompleted)

  const weekAgo = nowSec - 7 * 86_400
  const all = [...users.values()]
  const topUsers = all
    .sort((a, b) => (a.volume === b.volume ? b.lastSeen - a.lastSeen : a.volume < b.volume ? 1 : -1))
    .slice(0, opts.topUsers)
    .map((u): UserStat => ({ address: u.address, orders: u.orders, filled: u.filled, dcaPlans: u.dcaPlans, dcaRuns: u.dcaRuns, swaps: u.swaps, volumeUnits: u.volume.toString(), firstSeen: u.firstSeen, lastSeen: u.lastSeen }))

  return {
    decimals: USDC_DECIMALS,
    users: { total: all.length, active7d: all.filter((u) => u.lastSeen >= weekAgo).length, new7d: all.filter((u) => u.firstSeen >= weekAgo).length },
    orders,
    dca,
    swaps: { count: swaps.length, valued: swapsValued },
    volumeUnits: { total: (orderVol + dcaVol + swapVol).toString(), orders: orderVol.toString(), dca: dcaVol.toString(), swaps: swapVol.toString() },
    fees: {
      swapFeeBps: opts.feeBps,
      swapFeeEstimateUnits: feeEstimate.toString(),
      swapsFeeNotValued: feeNotValued,
      keeperFeeUsdcUnits: keeperUsdc.toString(),
      keeperFeeOtherTokenCount: keeperOther,
    },
    days: [...series].map(([date, d]) => ({ date, orderUnits: d.order.toString(), dcaUnits: d.dca.toString(), swapUnits: d.swap.toString(), totalUnits: (d.order + d.dca + d.swap).toString(), trades: d.trades })),
    topUsers,
    recent: recent.sort((a, b) => b.time - a.time).slice(0, 25),
  }
}
