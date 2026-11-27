import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { erc20Abi, zeroAddress, type Address, type PublicClient } from 'viem'
import { ordersAbi } from './ordersAbi'
import type { NetworkConfig, TokenInfo } from './networks'
import { fetchHealth } from './aggregator'
import { useTokenList } from './tokens'
import type { DcaView, OrderView } from './types'
import { Status } from './types'

export type OracleState =
  | { status: 'no-contract' }
  | { status: 'no-feed' }
  | { status: 'unavailable'; message: string }
  | { status: 'ok'; price18: bigint; updatedAt: number }

function revertName(e: unknown): string {
  const msg = e instanceof Error ? e.message : ''
  if (msg.includes('StalePrice')) return 'The oracle price is stale.'
  if (msg.includes('InvalidPrice')) return 'The oracle returned an invalid price.'
  if (msg.includes('TokenNotSupported')) return 'This token is not configured on the contract.'
  return 'The oracle price could not be read.'
}

export async function readOracle(client: PublicClient, orders: Address | undefined, base: Address): Promise<OracleState> {
  if (!orders) return { status: 'no-contract' }
  const cfg = await client.readContract({ address: orders, abi: ordersAbi, functionName: 'tokenConfigs', args: [base] })
  if (cfg[0] === zeroAddress) return { status: 'no-feed' }
  try {
    const [price18, updatedAt] = await client.readContract({ address: orders, abi: ordersAbi, functionName: 'currentPrice', args: [base] })
    return { status: 'ok', price18, updatedAt: Number(updatedAt) }
  } catch (e) {
    return { status: 'unavailable', message: revertName(e) }
  }
}

export function useOracle(network: NetworkConfig, base: TokenInfo | undefined) {
  const client = usePublicClient({ chainId: network.chainId })
  return useQuery({
    queryKey: ['oracle', network.key, base?.address, network.ordersAddress],
    enabled: Boolean(client && base),
    refetchInterval: 15_000,
    queryFn: async (): Promise<OracleState> => {
      if (!client || !base) return { status: 'no-contract' }
      return readOracle(client, network.ordersAddress, base.address)
    },
  })
}

const NO_PRICES: Record<string, OracleState | undefined> = {}

/**
 * Oracle state for several tokens at once, keyed by lowercase address. Two Multicall3 reads in total (feed
 * registration for every token, then the price for the ones that have a feed) instead of two calls per token,
 * which keeps the page well under the public RPC's rate limit.
 */
export function useOraclePrices(network: NetworkConfig, tokens: TokenInfo[]) {
  const client = usePublicClient({ chainId: network.chainId })
  const orders = network.ordersAddress
  const addresses = tokens.map((t) => t.address)
  const q = useQuery({
    queryKey: ['oracle', 'all', network.key, orders, addresses.join(',')],
    enabled: Boolean(client && addresses.length > 0),
    refetchInterval: 20_000,
    queryFn: async (): Promise<Record<string, OracleState | undefined>> => {
      const out: Record<string, OracleState | undefined> = {}
      if (!orders) {
        for (const a of addresses) out[a.toLowerCase()] = { status: 'no-contract' }
        return out
      }
      const configs = await client!.multicall({ contracts: addresses.map((a) => ({ address: orders, abi: ordersAbi, functionName: 'tokenConfigs' as const, args: [a] as const })), allowFailure: true })
      const withFeed = addresses.filter((_, i) => configs[i].status === 'success' && configs[i].result[0] !== zeroAddress)
      const prices = withFeed.length
        ? await client!.multicall({ contracts: withFeed.map((a) => ({ address: orders, abi: ordersAbi, functionName: 'currentPrice' as const, args: [a] as const })), allowFailure: true })
        : []
      addresses.forEach((a, i) => {
        const key = a.toLowerCase()
        const cfg = configs[i]
        if (cfg.status !== 'success') out[key] = { status: 'unavailable', message: 'The oracle price could not be read.' }
        else if (cfg.result[0] === zeroAddress) out[key] = { status: 'no-feed' }
        else {
          const r = prices[withFeed.indexOf(a)]
          out[key] = r && r.status === 'success' ? { status: 'ok', price18: r.result[0], updatedAt: Number(r.result[1]) } : { status: 'unavailable', message: revertName(r && r.status === 'failure' ? r.error : null) }
        }
      })
      return out
    },
  })
  return q.data ?? NO_PRICES
}

export function useBalances(network: NetworkConfig, owner: Address | undefined) {
  const client = usePublicClient({ chainId: network.chainId })
  // Every token the terminal lists, so a held token shows up whether or not it is tradable here.
  const listed = useTokenList(network).tokens
  const tokens = [network.quote, ...network.bases, ...listed.filter((t) => !network.bases.some((b) => b.address === t.address))]
  return useQuery({
    queryKey: ['balances', network.key, owner, tokens.length],
    enabled: Boolean(client && owner),
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!client || !owner) return {}
      // One Multicall3 request for every token instead of one RPC call per token. A token whose
      // balanceOf reverts counts as zero instead of hiding every other balance.
      const res = await client.multicall({
        contracts: tokens.map((t) => ({ address: t.address, abi: erc20Abi, functionName: 'balanceOf' as const, args: [owner] as const })),
        allowFailure: true,
      })
      return Object.fromEntries(tokens.map((t, i) => [t.address.toLowerCase(), res[i].status === 'success' ? res[i].result : 0n]))
    },
  })
}

export function useAllowance(network: NetworkConfig, token: Address | undefined, owner: Address | undefined, spender: Address | undefined) {
  const client = usePublicClient({ chainId: network.chainId })
  return useQuery({
    queryKey: ['allowance', network.key, token, owner, spender],
    enabled: Boolean(client && token && owner && spender),
    refetchInterval: 10_000,
    queryFn: async () => {
      if (!client || !token || !owner || !spender) return 0n
      return client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] })
    },
  })
}

/** Reads an owner's orders with two batched requests (all orders, then readiness for the open ones). */
export function useOrders(network: NetworkConfig, owner: Address | undefined) {
  const client = usePublicClient({ chainId: network.chainId })
  const orders = network.ordersAddress
  return useQuery({
    queryKey: ['orders', network.key, owner, orders],
    enabled: Boolean(client && owner && orders),
    refetchInterval: 12_000,
    queryFn: async (): Promise<OrderView[]> => {
      if (!client || !owner || !orders) return []
      const ids = await client.readContract({ address: orders, abi: ordersAbi, functionName: 'getOrderIds', args: [owner] })
      if (ids.length === 0) return []
      // One request for every row and its readiness. checkOrder answers "not open" for closed orders, so the
      // readiness of closed ones is simply ignored below.
      const data = await client.multicall({
        contracts: ids.flatMap((id) => [
          { address: orders, abi: ordersAbi, functionName: 'getOrder' as const, args: [id] as const },
          { address: orders, abi: ordersAbi, functionName: 'checkOrder' as const, args: [id] as const },
        ]),
        allowFailure: true,
      })
      const views: OrderView[] = []
      ids.forEach((id, i) => {
        const row = data[i * 2]
        if (row.status !== 'success') return
        const view: OrderView = { id, ...(row.result as Omit<OrderView, 'id'>) }
        const check = data[i * 2 + 1]
        if (view.status === Status.OPEN && check.status === 'success') {
          const c = check.result as readonly [boolean, number, bigint, bigint]
          view.reasonCode = c[1]
          view.livePrice = c[2]
        }
        views.push(view)
      })
      return views
    },
  })
}

export function useDcas(network: NetworkConfig, owner: Address | undefined) {
  const client = usePublicClient({ chainId: network.chainId })
  const orders = network.ordersAddress
  return useQuery({
    queryKey: ['dcas', network.key, owner, orders],
    enabled: Boolean(client && owner && orders),
    refetchInterval: 12_000,
    queryFn: async (): Promise<DcaView[]> => {
      if (!client || !owner || !orders) return []
      const ids = await client.readContract({ address: orders, abi: ordersAbi, functionName: 'getDcaIds', args: [owner] })
      if (ids.length === 0) return []
      const data = await client.multicall({
        contracts: ids.flatMap((id) => [
          { address: orders, abi: ordersAbi, functionName: 'getDca' as const, args: [id] as const },
          { address: orders, abi: ordersAbi, functionName: 'checkDca' as const, args: [id] as const },
        ]),
        allowFailure: true,
      })
      const views: DcaView[] = []
      ids.forEach((id, i) => {
        const row = data[i * 2]
        if (row.status !== 'success') return
        const view: DcaView = { id, ...(row.result as Omit<DcaView, 'id'>) }
        const check = data[i * 2 + 1]
        if (view.status <= 1 && check.status === 'success') view.reasonCode = (check.result as readonly [boolean, number, bigint, bigint])[1]
        views.push(view)
      })
      return views
    },
  })
}

export interface ExecutionLog {
  kind: 'order' | 'dca'
  id: bigint
  amountIn: bigint
  net: bigint
  keeperFee: bigint
  blockNumber: bigint
  txHash: `0x${string}`
  time?: number
}

const LOG_CHUNK = 10_000n
const MAX_CHUNKS = 8
const LOG_CACHE_VERSION = 1

interface StoredLogs {
  v: number
  scannedTo: string
  logs: (Omit<ExecutionLog, 'id' | 'amountIn' | 'net' | 'keeperFee' | 'blockNumber'> & { id: string; amountIn: string; net: string; keeperFee: string; blockNumber: string })[]
}

function loadLogCache(key: string): { scannedTo: bigint; logs: ExecutionLog[] } | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const s = JSON.parse(raw) as StoredLogs
    if (s.v !== LOG_CACHE_VERSION) return null
    return {
      scannedTo: BigInt(s.scannedTo),
      logs: s.logs.map((l) => ({ ...l, id: BigInt(l.id), amountIn: BigInt(l.amountIn), net: BigInt(l.net), keeperFee: BigInt(l.keeperFee), blockNumber: BigInt(l.blockNumber) })),
    }
  } catch {
    return null
  }
}

function saveLogCache(key: string, scannedTo: bigint, logs: ExecutionLog[]) {
  try {
    const s: StoredLogs = {
      v: LOG_CACHE_VERSION,
      scannedTo: scannedTo.toString(),
      logs: logs.map((l) => ({ ...l, id: l.id.toString(), amountIn: l.amountIn.toString(), net: l.net.toString(), keeperFee: l.keeperFee.toString(), blockNumber: l.blockNumber.toString() })),
    }
    localStorage.setItem(key, JSON.stringify(s))
  } catch {
    /* storage full or unavailable: the next load simply rescans */
  }
}

/**
 * Executions for one owner. The first load starts at the deployment block (or head minus 5,000 when
 * unknown), never block 0. Every later load resumes from the last scanned block kept in localStorage,
 * so a refresh costs one small range instead of a full rescan.
 */
export function useExecutionLogs(network: NetworkConfig, owner: Address | undefined) {
  const client = usePublicClient({ chainId: network.chainId })
  const orders = network.ordersAddress
  return useQuery({
    queryKey: ['exec-logs', network.key, owner, orders],
    enabled: Boolean(client && owner && orders),
    refetchInterval: 20_000,
    queryFn: async (): Promise<{ logs: ExecutionLog[]; partial: boolean; fromBlock: bigint; head: bigint }> => {
      if (!client || !owner || !orders) return { logs: [], partial: false, fromBlock: 0n, head: 0n }
      const cacheKey = `arc-terminal-logs-v${LOG_CACHE_VERSION}:${network.chainId}:${orders.toLowerCase()}:${owner.toLowerCase()}`
      const cached = loadLogCache(cacheKey)
      const head = await client.getBlockNumber()
      let from = head > 5000n ? head - 5000n : 0n
      if (cached) {
        from = cached.scannedTo + 1n
      } else if (network.deployTxHash) {
        try {
          const receipt = await client.getTransactionReceipt({ hash: network.deployTxHash })
          from = receipt.blockNumber
        } catch {
          /* fall back to the bounded lookback above */
        }
      }
      const orderEvent = ordersAbi.find((x) => x.type === 'event' && x.name === 'OrderExecuted')
      const dcaEvent = ordersAbi.find((x) => x.type === 'event' && x.name === 'DcaExecuted')
      const existing = cached?.logs ?? []
      if (!orderEvent || !dcaEvent || from > head) return { logs: existing, partial: false, fromBlock: from, head }

      const fresh: ExecutionLog[] = []
      let partial = false
      let cursor = from
      let scannedTo = cached?.scannedTo ?? from - 1n
      let chunks = 0
      type Raw = { args: { id: bigint; amountIn: bigint; net: bigint; keeperFee: bigint }; blockNumber: bigint; transactionHash: `0x${string}` }
      while (cursor <= head && chunks < MAX_CHUNKS) {
        const to = cursor + LOG_CHUNK - 1n > head ? head : cursor + LOG_CHUNK - 1n
        try {
          const [o, d] = await Promise.all([
            client.getLogs({ address: orders, event: orderEvent as never, args: { owner } as never, fromBlock: cursor, toBlock: to }),
            client.getLogs({ address: orders, event: dcaEvent as never, args: { owner } as never, fromBlock: cursor, toBlock: to }),
          ])
          for (const l of o as unknown as Raw[]) fresh.push({ kind: 'order', id: l.args.id, amountIn: l.args.amountIn, net: l.args.net, keeperFee: l.args.keeperFee, blockNumber: l.blockNumber, txHash: l.transactionHash })
          for (const l of d as unknown as Raw[]) fresh.push({ kind: 'dca', id: l.args.id, amountIn: l.args.amountIn, net: l.args.net, keeperFee: l.args.keeperFee, blockNumber: l.blockNumber, txHash: l.transactionHash })
        } catch {
          partial = true
          break
        }
        scannedTo = to
        cursor = to + 1n
        chunks++
      }
      if (cursor <= head) partial = true

      // Block timestamps for new rows only (bounded), so history rows carry real times.
      const blocks = [...new Set(fresh.map((l) => l.blockNumber))].slice(-60)
      const times = new Map<bigint, number>()
      await Promise.all(
        blocks.map(async (n) => {
          try {
            const b = await client.getBlock({ blockNumber: n })
            times.set(n, Number(b.timestamp))
          } catch {
            /* leave the time empty rather than invent one */
          }
        }),
      )
      for (const l of fresh) l.time = times.get(l.blockNumber)
      const merged = [...existing, ...fresh].sort((a, b) => Number(b.blockNumber - a.blockNumber))
      if (scannedTo >= from) saveLogCache(cacheKey, scannedTo, merged)
      return { logs: merged, partial, fromBlock: from, head }
    },
  })
}

/** Current unix time in seconds, refreshed on an interval so renders stay pure. */
export function useNowSeconds(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function useBackendHealth() {
  // Several components read this at once (header, footer, forms). staleTime stops each one from refetching when it mounts.
  return useQuery({ queryKey: ['backend-health'], queryFn: fetchHealth, refetchInterval: 20_000, staleTime: 15_000, retry: false })
}
