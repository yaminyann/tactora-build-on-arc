import { describe, expect, test } from 'bun:test'
import type { Address, Hex } from 'viem'
import { CirclePasskeyProvider, ProviderRpcError, mapPasskeyError, type Call, type CircleAccountHandle, type CircleProviderDeps } from '../src/wallet/circleProvider'
import { circleConfig, sponsorGas } from '../src/wallet/circle'

const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const TESTNET = 5042002
const MAINNET = 5042
const TX_HASH = ('0x' + 'ab'.repeat(32)) as Hex

function setup(over: Partial<CircleAccountHandle> = {}, sponsor = true) {
  const sent: { calls: Call[]; sponsor: boolean }[] = []
  const rpc: { chainId: number; method: string; params: unknown[] }[] = []
  const handle: CircleAccountHandle = {
    address: ACCOUNT,
    signMessage: async () => ('0x' + '11'.repeat(65)) as Hex,
    signTypedData: async () => ('0x' + '22'.repeat(65)) as Hex,
    sendCalls: async (calls, opts) => {
      sent.push({ calls, sponsor: opts.sponsor })
      return TX_HASH
    },
    ...over,
  }
  const deps: CircleProviderDeps = {
    supportedChains: [TESTNET, MAINNET],
    sponsor: () => sponsor,
    account: async () => handle,
    rpc: async (chainId, method, params) => {
      rpc.push({ chainId, method, params })
      return '0x1'
    },
  }
  return { provider: new CirclePasskeyProvider(deps, TESTNET), sent, rpc }
}

describe('passkey wallet provider', () => {
  test('answers account and chain questions', async () => {
    const { provider } = setup()
    expect(await provider.request({ method: 'eth_chainId' })).toBe('0x4cef52')
    expect(await provider.request({ method: 'eth_accounts' })).toEqual([ACCOUNT])
    expect(await provider.request({ method: 'eth_requestAccounts' })).toEqual([ACCOUNT])
    expect(await provider.request({ method: 'net_version' })).toBe('5042002')
  })

  test('a transaction becomes one user operation, sponsored when asked, and returns the transaction hash', async () => {
    const { provider, sent } = setup()
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ to: '0x2222222222222222222222222222222222222222', data: '0xdeadbeef', value: '0x0' }] })
    expect(hash).toBe(TX_HASH)
    expect(sent).toEqual([{ calls: [{ to: '0x2222222222222222222222222222222222222222', data: '0xdeadbeef', value: 0n }], sponsor: true }])
    const unsponsored = setup({}, false)
    await unsponsored.provider.request({ method: 'eth_sendTransaction', params: [{ to: '0x2222222222222222222222222222222222222222', value: '0x10' }] })
    expect(unsponsored.sent[0]).toEqual({ calls: [{ to: '0x2222222222222222222222222222222222222222', data: undefined, value: 16n }], sponsor: false })
  })

  test('a transaction without a destination is refused', async () => {
    const { provider, sent } = setup()
    await expect(provider.request({ method: 'eth_sendTransaction', params: [{ data: '0x00' }] })).rejects.toThrow('destination')
    expect(sent).toHaveLength(0)
  })

  test('a cancelled fingerprint prompt is reported as a rejection, so the app says "cancelled"', async () => {
    const denied = Object.assign(new Error('The operation either timed out or was not allowed'), { name: 'NotAllowedError' })
    const { provider } = setup({ sendCalls: async () => Promise.reject(denied) })
    const err = (await provider.request({ method: 'eth_sendTransaction', params: [{ to: ACCOUNT }] }).catch((e: unknown) => e)) as ProviderRpcError
    expect(err).toBeInstanceOf(ProviderRpcError)
    expect(err.code).toBe(4001)
    expect(err.message).toContain('rejected')
    expect(mapPasskeyError(Object.assign(new Error('x'), { name: 'SecurityError' }))).toMatchObject({ code: 4100 })
    const plain = new Error('bundler said no')
    expect(mapPasskeyError(plain)).toBe(plain)
  })

  test('signing goes to the account, typed data may arrive as a JSON string', async () => {
    const seen: unknown[] = []
    const { provider } = setup({ signTypedData: async (d) => (seen.push(d), ('0x' + '33'.repeat(65)) as Hex) })
    expect(await provider.request({ method: 'personal_sign', params: ['0x68656c6c6f', ACCOUNT] })).toBe('0x' + '11'.repeat(65))
    await provider.request({ method: 'eth_signTypedData_v4', params: [ACCOUNT, JSON.stringify({ domain: { name: 'x' } })] })
    expect(seen[0]).toEqual({ domain: { name: 'x' } })
  })

  test('switching chain works for supported chains, emits chainChanged, and refuses others', async () => {
    const { provider } = setup()
    const events: unknown[] = []
    provider.on('chainChanged', (c) => events.push(c))
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x13b2' }] })
    expect(provider.currentChainId).toBe(MAINNET)
    expect(events).toEqual(['0x13b2'])
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x13b2' }] })
    expect(events).toHaveLength(1)
    await expect(provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] })).rejects.toThrow('not supported')
    expect(() => new CirclePasskeyProvider({ ...({} as CircleProviderDeps), supportedChains: [TESTNET] }, 1)).toThrow('not supported')
  })

  test('unsupported signing methods are refused and everything else is a plain RPC read', async () => {
    const { provider, rpc } = setup()
    await expect(provider.request({ method: 'eth_sign', params: [] })).rejects.toThrow('not supported')
    await expect(provider.request({ method: 'eth_signTransaction', params: [] })).rejects.toThrow('not supported')
    expect(await provider.request({ method: 'eth_blockNumber', params: [] })).toBe('0x1')
    expect(rpc).toEqual([{ chainId: TESTNET, method: 'eth_blockNumber', params: [] }])
  })
})

describe('passkey wallet configuration', () => {
  test('is off without a Client Key, and uses Circle\'s URL unless told otherwise', () => {
    expect(circleConfig({})).toBeNull()
    expect(circleConfig({ VITE_CIRCLE_CLIENT_KEY: '   ' })).toBeNull()
    expect(circleConfig({ VITE_CIRCLE_CLIENT_KEY: 'TEST_API_KEY:abc:def' })).toEqual({ clientKey: 'TEST_API_KEY:abc:def', clientUrl: 'https://modular-sdk.circle.com/v1/rpc/w3s/buidl' })
    expect(circleConfig({ VITE_CIRCLE_CLIENT_KEY: 'k', VITE_CIRCLE_CLIENT_URL: 'https://example.test/rpc/' })?.clientUrl).toBe('https://example.test/rpc')
    // A plain-http endpoint would send the key in the clear: refused.
    expect(circleConfig({ VITE_CIRCLE_CLIENT_KEY: 'k', VITE_CIRCLE_CLIENT_URL: 'http://example.test' })).toBeNull()
  })

  test('gas is sponsored on testnet by default and never on mainnet unless switched on', () => {
    expect(sponsorGas(TESTNET, {})).toBe(true)
    expect(sponsorGas(MAINNET, {})).toBe(false)
    expect(sponsorGas(MAINNET, { VITE_CIRCLE_SPONSOR_GAS: 'true' })).toBe(true)
    expect(sponsorGas(TESTNET, { VITE_CIRCLE_SPONSOR_GAS: 'false' })).toBe(false)
  })
})
