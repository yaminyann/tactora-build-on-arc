/**
 * AggregatorAdapter: the single seam between the UI and a DEX aggregator.
 * Add another provider by implementing this interface and registering it in `getAggregator`.
 * No adapter ever fabricates a quote: unavailable means unavailable.
 */
import { createPublicClient, decodeFunctionData, encodeFunctionData, erc20Abi, http, parseAbi, type Address, type Hex } from 'viem'
import { getChain } from '@/onchain-facts'
import type { NetworkConfig } from './networks'

export interface SwapQuoteRequest {
  chainId: number
  sellToken: Address
  buyToken: Address
  sellAmount: bigint
  taker: Address
  slippageBps: number
}

export interface RouteFill {
  from: string
  to: string
  source: string
  proportionBps: string
}

export interface SwapQuote {
  /** Aggregator that produced this quote (for example 0x or kyber), when the gateway reports it. */
  provider?: string
  alternatives?: { provider: string; buyAmount: bigint }[]
  buyAmount: bigint
  minBuyAmount: bigint
  sellAmount: bigint
  route: RouteFill[]
  /** Network fee in the 18-decimal native USDC view, when the provider supplies one. */
  networkFeeNative: bigint | null
  /** Spender that must hold an ERC-20 allowance for the sell token, when not already approved. */
  allowanceSpender: Address | null
  allowanceActual: bigint | null
  /** Platform fee already taken out of the sell amount, when the backend charges one. */
  platformFee?: { bps: number; amount: bigint }
  /** Present for firm quotes only. */
  transaction?: { to: Address; data: Hex; value: bigint; gas: bigint | null }
}

export class AggregatorError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface AggregatorAdapter {
  id: string
  name: string
  /** Why swaps are unavailable on this network, or null when they can work. */
  unavailableReason(): string | null
  price(req: SwapQuoteRequest): Promise<SwapQuote | null>
  quote(req: SwapQuoteRequest): Promise<SwapQuote | null>
}

interface RawQuote {
  provider?: string
  alternatives?: { provider: string; buyAmount: string }[]
  liquidityAvailable: boolean
  buyAmount?: string
  minBuyAmount?: string
  sellAmount?: string
  route?: RouteFill[]
  totalNetworkFee?: string | null
  issues?: { allowance?: { actual: string; spender: string } | null }
  platformFee?: { bps: number; amount: string } | null
  transaction?: { to: string; data: string; value: string; gas?: string | null }
  error?: { code: string; message: string }
}

/**
 * The quote comes from our backend over the network, so it is not trusted. A swap may only go to a
 * known swap contract with no native value, and an approval may only name a known swap contract.
 * Throws instead of returning a flag so no caller can forget to check.
 */
export function assertSafeSwapQuote(allowedTargets: readonly Address[], quote: SwapQuote): void {
  const allowed = new Set(allowedTargets.map((a) => a.toLowerCase()))
  if (quote.transaction) {
    if (!allowed.has(quote.transaction.to.toLowerCase())) {
      throw new AggregatorError('UNTRUSTED_TARGET', `Refusing to send to ${quote.transaction.to}: it is not a known swap contract.`)
    }
    // Arc's gas token is the same USDC the swap sells, and no supported route needs msg.value.
    if (quote.transaction.value !== 0n) {
      throw new AggregatorError('UNTRUSTED_VALUE', 'Refusing a swap that asks to send native value.')
    }
  }
  if (quote.allowanceSpender && !allowed.has(quote.allowanceSpender.toLowerCase())) {
    throw new AggregatorError('UNTRUSTED_SPENDER', `Refusing to approve ${quote.allowanceSpender}: it is not a known swap contract.`)
  }
}

/** KyberSwap MetaAggregationRouterV2 entry point, checked against a live quote (selector 0xe21fd0e9). */
const kyberAbi = parseAbi([
  'function swap((address callTarget,address approveTarget,bytes targetData,(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)',
])
/** 0x AllowanceHolder entry point. The settler payload inside `data` is not decoded. */
const zeroExAbi = parseAbi(['function exec(address operator, address token, uint256 amount, address target, bytes data) payable returns (bytes)'])

const KYBER_ROUTER_ADDRESS = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5'
const ZEROEX_ALLOWANCE_HOLDER_ADDRESS = '0x0000000000001fF3684f28c67538d4D072C22734'

/**
 * The calldata comes from our backend over the network, so it is not trusted either. Pinning the target is not
 * enough: calldata to the right router can still pay the output to someone else or accept almost nothing back.
 * Public Arc RPCs do not support transaction simulation, so the calldata itself is read and checked against the
 * request the user made. Anything that is not recognised on a known router is refused (fail closed).
 *
 *  - KyberSwap swap(): token in and out, the receiver (must be the taker), the amount, and a minimum return that
 *    is no looser than the user's slippage allows, are all verified.
 *  - 0x exec(): the token and amount that move are verified. The receiver lives inside the settler payload, which
 *    is not decoded here, so for 0x this is a partial check.
 *  - The testnet router builds its own calldata in the browser and is not passed through here.
 */
export function assertSwapMatchesRequest(req: SwapQuoteRequest, quote: SwapQuote): void {
  const tx = quote.transaction
  if (!tx) return
  const to = tx.to.toLowerCase()
  const refuse = (why: string): never => {
    throw new AggregatorError('CALLDATA_MISMATCH', `Refusing this swap: ${why}. Nothing was sent.`)
  }
  if (to === KYBER_ROUTER_ADDRESS.toLowerCase()) {
    let desc
    try {
      desc = decodeFunctionData({ abi: kyberAbi, data: tx.data }).args[0].desc
    } catch {
      return refuse('the swap calldata is not a recognised KyberSwap swap')
    }
    if (desc.srcToken.toLowerCase() !== req.sellToken.toLowerCase() || desc.dstToken.toLowerCase() !== req.buyToken.toLowerCase()) return refuse('it swaps different tokens than you asked for')
    if (desc.dstReceiver.toLowerCase() !== req.taker.toLowerCase()) return refuse('it would send the output to a different address')
    const fees = desc.feeAmounts.reduce((a, b) => a + b, 0n)
    if (desc.amount !== req.sellAmount && desc.amount + fees !== req.sellAmount) return refuse('it sells a different amount than you entered')
    // The quote's own minimum is the floor. Allow the user's slippage plus a little rounding, never more.
    const floor = (quote.buyAmount * BigInt(10_000 - req.slippageBps - 50)) / 10_000n
    if (desc.minReturnAmount < floor) return refuse('its minimum output is far below what you accepted')
    return
  }
  if (to === ZEROEX_ALLOWANCE_HOLDER_ADDRESS.toLowerCase()) {
    let args
    try {
      args = decodeFunctionData({ abi: zeroExAbi, data: tx.data }).args
    } catch {
      return refuse('the swap calldata is not a recognised 0x swap')
    }
    if (args[1].toLowerCase() !== req.sellToken.toLowerCase()) return refuse('it moves a different token than you asked for')
    if (args[2] !== req.sellAmount) return refuse('it moves a different amount than you entered')
  }
}

export function parseRawQuote(raw: RawQuote): SwapQuote | null {
  if (!raw.liquidityAvailable || !raw.buyAmount || !raw.minBuyAmount || !raw.sellAmount) return null
  return {
    provider: raw.provider,
    alternatives: raw.alternatives?.map((a) => ({ provider: a.provider, buyAmount: BigInt(a.buyAmount) })),
    buyAmount: BigInt(raw.buyAmount),
    minBuyAmount: BigInt(raw.minBuyAmount),
    sellAmount: BigInt(raw.sellAmount),
    route: raw.route ?? [],
    networkFeeNative: raw.totalNetworkFee ? BigInt(raw.totalNetworkFee) : null,
    allowanceSpender: (raw.issues?.allowance?.spender as Address | undefined) ?? null,
    allowanceActual: raw.issues?.allowance ? BigInt(raw.issues.allowance.actual) : null,
    platformFee: raw.platformFee ? { bps: raw.platformFee.bps, amount: BigInt(raw.platformFee.amount) } : undefined,
    transaction: raw.transaction
      ? {
          to: raw.transaction.to as Address,
          data: raw.transaction.data as Hex,
          value: BigInt(raw.transaction.value ?? '0'),
          gas: raw.transaction.gas ? BigInt(raw.transaction.gas) : null,
        }
      : undefined,
  }
}

/** 0x Swap API (AllowanceHolder) through this project's backend, which keeps the API key secret. */
export class ZeroExAdapter implements AggregatorAdapter {
  id = '0x'
  name = '0x'
  constructor(private network: NetworkConfig) {}

  unavailableReason(): string | null {
    return this.network.zeroEx.supported ? null : this.network.zeroEx.reason
  }

  private async call(path: 'price' | 'quote', req: SwapQuoteRequest): Promise<SwapQuote | null> {
    const reason = this.unavailableReason()
    if (reason) throw new AggregatorError('CHAIN_NOT_SUPPORTED', reason)
    const qs = new URLSearchParams({
      chainId: String(req.chainId),
      sellToken: req.sellToken,
      buyToken: req.buyToken,
      sellAmount: req.sellAmount.toString(),
      taker: req.taker,
      slippageBps: String(req.slippageBps),
    })
    let res: Response
    try {
      res = await fetch(`/api/${path}?${qs}`)
    } catch {
      throw new AggregatorError('BACKEND_UNREACHABLE', 'The quote service is not reachable. Start the backend with `bun run server`.')
    }
    const raw = (await res.json().catch(() => ({}))) as RawQuote
    if (!res.ok) {
      throw new AggregatorError(raw.error?.code ?? 'UPSTREAM_ERROR', raw.error?.message ?? `Quote request failed (${res.status})`)
    }
    const parsed = parseRawQuote(raw)
    if (parsed) {
      assertSafeSwapQuote(this.network.swapTargets, parsed)
      assertSwapMatchesRequest(req, parsed)
    }
    return parsed
  }

  price(req: SwapQuoteRequest) {
    return this.call('price', req)
  }

  quote(req: SwapQuoteRequest) {
    return this.call('quote', req)
  }
}

export const testRouterAbi = [
  { type: 'function', name: 'quote', stateMutability: 'view', inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'swapExactIn', stateMutability: 'nonpayable', inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const

/**
 * TESTNET ONLY. Quotes come from the deployed test router contract, which prices swaps at the public
 * test feeds minus a fixed 0.10% fee. It is a real contract and a real transaction, but the price is
 * not market data. It exists because Arc Testnet has no aggregator.
 */
export class TestRouterAdapter implements AggregatorAdapter {
  id = 'test-router'
  name = 'Test router'
  constructor(private network: NetworkConfig) {}

  unavailableReason(): string | null {
    return this.network.testHarness ? null : 'No test router is configured for this network.'
  }

  private async build(req: SwapQuoteRequest, firm: boolean): Promise<SwapQuote | null> {
    const router = this.network.testHarness?.router
    const rpc = getChain(this.network.chainId)?.rpcUrls[0]
    if (!router || !rpc) throw new AggregatorError('NO_ROUTER', 'The test router is not configured.')
    const client = createPublicClient({ transport: http(rpc) })
    let buyAmount: bigint
    try {
      buyAmount = await client.readContract({ address: router, abi: testRouterAbi, functionName: 'quote', args: [req.sellToken, req.buyToken, req.sellAmount] })
    } catch {
      // No feed for one side of the pair, or a stale feed: say so instead of inventing a price.
      return null
    }
    if (buyAmount === 0n) return null
    // The router pays USDC from its own balance. If it cannot cover this trade the swap would revert, so there is no route.
    if (req.buyToken.toLowerCase() === this.network.quote.address.toLowerCase()) {
      const have = await client.readContract({ address: req.buyToken, abi: erc20Abi, functionName: 'balanceOf', args: [router] }).catch(() => null)
      if (have !== null && have < buyAmount) return null
    }
    const allowance = await client.readContract({ address: req.sellToken, abi: erc20Abi, functionName: 'allowance', args: [req.taker, router] })
    return {
      buyAmount,
      minBuyAmount: (buyAmount * BigInt(10_000 - req.slippageBps)) / 10_000n,
      sellAmount: req.sellAmount,
      route: [{ from: req.sellToken, to: req.buyToken, source: 'Test router (feed price, 0.10% fee)', proportionBps: '10000' }],
      networkFeeNative: null,
      allowanceSpender: router,
      allowanceActual: allowance,
      transaction: firm
        ? { to: router, data: encodeFunctionData({ abi: testRouterAbi, functionName: 'swapExactIn', args: [req.sellToken, req.buyToken, req.sellAmount] }), value: 0n, gas: null }
        : undefined,
    }
  }

  price(req: SwapQuoteRequest) {
    return this.build(req, false)
  }

  quote(req: SwapQuoteRequest) {
    return this.build(req, true)
  }
}

export function getAggregator(network: NetworkConfig): AggregatorAdapter {
  return network.testHarness ? new TestRouterAdapter(network) : new ZeroExAdapter(network)
}

export interface BackendHealth {
  ok: boolean
  zeroEx: { configured: boolean; chains: number[] }
  /** Present on gateway-enabled backends: true when at least one quote provider is usable. */
  gateway?: { configured: boolean; providers: { id: string; configured: boolean; breaker: string; consecutiveFailures: number }[] }
  keeper: { enabled: boolean; running: boolean; network: string; keeperAddress: string | null; lastTick: number | null; lastError: string | null; executed: number; notes: string[] }
  automationProviders: { id: string; name: string; state: string; summary: string; evidence: string }[]
  /** True when the operator has switched on the optional chat model for the Agent. */
  agentChat?: { enabled: boolean }
  /** Fee charged on browser market swaps. `recipient` and `platformFeeProblem` are sent to operators only. */
  platformFee?: { bps: number; recipient?: string } | null
  platformFeeProblem?: string
  indexer?: { enabled: boolean; running: boolean; lagBlocks: number | null; lastError: string | null }
}

export async function fetchHealth(): Promise<BackendHealth> {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error('Backend unavailable')
  return (await res.json()) as BackendHealth
}
