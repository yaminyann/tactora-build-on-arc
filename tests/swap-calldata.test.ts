import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, encodeFunctionData, parseAbi, type Address, type Hex } from 'viem'
import { AggregatorError, assertSwapMatchesRequest, parseRawQuote, type SwapQuote, type SwapQuoteRequest } from '../src/trading/aggregator'
import fixture from './fixtures/kyber-usdc-eurc-quote.json'

// A real KyberSwap quote for 10 USDC to EURC on Arc, captured through the gateway on 2026-11-26.
const TAKER = '0xD9fB5814Efc81848E654312860E0401AE88b115E' as Address
const USDC = '0x3600000000000000000000000000000000000000' as Address
const EURC = '0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1' as Address
const req: SwapQuoteRequest = { chainId: 5042, sellToken: USDC, buyToken: EURC, sellAmount: 10_000_000n, taker: TAKER, slippageBps: 50 }

const kyberAbi = parseAbi([
  'function swap((address callTarget,address approveTarget,bytes targetData,(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)',
])

function quote(): SwapQuote {
  const q = parseRawQuote(fixture as never)
  if (!q?.transaction) throw new Error('fixture has no transaction')
  return q
}

/** Re-encodes the real calldata with one field of the swap description changed. */
function tampered(change: (desc: Record<string, unknown>) => void): SwapQuote {
  const q = quote()
  const decoded = decodeFunctionData({ abi: kyberAbi, data: q.transaction!.data })
  const exec = structuredClone(decoded.args[0]) as unknown as { desc: Record<string, unknown> }
  change(exec.desc)
  const data = encodeFunctionData({ abi: kyberAbi, functionName: 'swap', args: [exec as never] })
  return { ...q, transaction: { ...q.transaction!, data } }
}

const refused = (q: SwapQuote, r: SwapQuoteRequest = req) => {
  try {
    assertSwapMatchesRequest(r, q)
  } catch (e) {
    expect(e).toBeInstanceOf(AggregatorError)
    expect((e as AggregatorError).code).toBe('CALLDATA_MISMATCH')
    return true
  }
  return false
}

describe('swap calldata is checked against what the user asked for', () => {
  test('the real KyberSwap calldata passes', () => {
    expect(() => assertSwapMatchesRequest(req, quote())).not.toThrow()
  })

  test('output paid to another address is refused', () => {
    expect(refused(tampered((d) => (d.dstReceiver = '0x000000000000000000000000000000000000dEaD')))).toBe(true)
  })

  test('a minimum return far below the accepted slippage is refused', () => {
    expect(refused(tampered((d) => (d.minReturnAmount = 1n)))).toBe(true)
    expect(refused(tampered((d) => (d.minReturnAmount = 5_000_000n)))).toBe(true)
  })

  test('different tokens or a different amount are refused', () => {
    expect(refused(tampered((d) => (d.dstToken = USDC)))).toBe(true)
    expect(refused(tampered((d) => (d.srcToken = EURC)))).toBe(true)
    expect(refused(tampered((d) => (d.amount = 99_000_000n)))).toBe(true)
  })

  test('the request itself must match: another taker, token or amount makes the real calldata wrong', () => {
    expect(refused(quote(), { ...req, taker: '0x0000000000000000000000000000000000000001' })).toBe(true)
    expect(refused(quote(), { ...req, sellAmount: 5_000_000n })).toBe(true)
    expect(refused(quote(), { ...req, buyToken: USDC })).toBe(true)
  })

  test('unrecognised calldata to the router is refused, not waved through', () => {
    const q = quote()
    expect(refused({ ...q, transaction: { ...q.transaction!, data: '0xdeadbeef' as Hex } })).toBe(true)
    expect(refused({ ...q, transaction: { ...q.transaction!, data: '0x' as Hex } })).toBe(true)
  })

  test('a fee taken from the sell amount is allowed when the parts add up', () => {
    expect(() => assertSwapMatchesRequest(req, tampered((d) => {
      d.amount = 9_970_000n
      d.feeReceivers = ['0x000000000000000000000000000000000000dEaD']
      d.feeAmounts = [30_000n]
    }))).not.toThrow()
  })

  test('0x exec: the token and amount that move are checked', () => {
    const zeroExAbi = parseAbi(['function exec(address operator, address token, uint256 amount, address target, bytes data) payable returns (bytes)'])
    const holder = '0x0000000000001fF3684f28c67538d4D072C22734' as Address
    const build = (token: Address, amount: bigint): SwapQuote => ({
      ...quote(),
      transaction: { to: holder, value: 0n, gas: null, data: encodeFunctionData({ abi: zeroExAbi, functionName: 'exec', args: [holder, token, amount, holder, '0x'] }) },
    })
    expect(() => assertSwapMatchesRequest(req, build(USDC, 10_000_000n))).not.toThrow()
    expect(refused(build(EURC, 10_000_000n))).toBe(true)
    expect(refused(build(USDC, 20_000_000n))).toBe(true)
  })

  test('a quote without a transaction (a price) and a testnet router call are not touched', () => {
    const q = quote()
    expect(() => assertSwapMatchesRequest(req, { ...q, transaction: undefined })).not.toThrow()
    const testRouter = '0x6812943fc8cf6acf9a098cbabb2277112d77a93f' as Address
    expect(() => assertSwapMatchesRequest(req, { ...q, transaction: { ...q.transaction!, to: testRouter, data: '0x1234' as Hex } })).not.toThrow()
  })
})
