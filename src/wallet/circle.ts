/**
 * Circle Modular Wallets: a wallet that signs with a passkey (fingerprint, Face ID or a security key).
 *
 * Needs a free Client Key from the Circle Console (see docs/api-keys.md). Without one the passkey option is simply not
 * offered. The SDK is loaded only when someone uses it, so it adds nothing to the first page load.
 *
 * Notes on safety:
 *  - The private key stays in the device's secure hardware. The page only ever sees a credential id and a public key.
 *  - That credential is kept in sessionStorage (this tab only), not localStorage. A new tab asks for a fingerprint again.
 *  - Every transaction still needs the fingerprint: the account cannot sign anything without a prompt on the device.
 */
import { createPublicClient } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import type { P256Credential } from 'viem/account-abstraction'
import { CirclePasskeyProvider, type CircleAccountHandle, type CircleProviderDeps } from './circleProvider'

const DEFAULT_CLIENT_URL = 'https://modular-sdk.circle.com/v1/rpc/w3s/buidl'

/** Chain id to the path segment the Circle transport expects, and the viem chain. */
const CIRCLE_CHAINS = {
  5042002: { path: 'arcTestnet', chain: arcTestnet },
  5042: { path: 'arc', chain: arc },
} as const

export const CIRCLE_CHAIN_IDS = Object.keys(CIRCLE_CHAINS).map(Number)

export interface CircleConfig {
  clientKey: string
  clientUrl: string
}

/** The Client Key from the environment, or null when the passkey wallet is not set up. */
export function circleConfig(env: Record<string, string | undefined> = import.meta.env): CircleConfig | null {
  const clientKey = env.VITE_CIRCLE_CLIENT_KEY?.trim()
  if (!clientKey) return null
  const url = env.VITE_CIRCLE_CLIENT_URL?.trim().replace(/\/+$/, '') || DEFAULT_CLIENT_URL
  if (!/^https:\/\//.test(url)) return null
  return { clientKey, clientUrl: url }
}

export const circleEnabled = circleConfig() !== null

/**
 * Whether Circle's Gas Station pays the network fee. Testnet: yes by default. Mainnet: no by default, because a
 * paymaster policy must exist in the Circle Console first (error 155509 otherwise). Set VITE_CIRCLE_SPONSOR_GAS to
 * true or false to override. Without sponsoring, the smart account pays gas in its own USDC balance.
 */
export function sponsorGas(chainId: number, env: Record<string, string | undefined> = import.meta.env): boolean {
  const v = env.VITE_CIRCLE_SPONSOR_GAS?.trim().toLowerCase()
  if (v === 'true') return true
  if (v === 'false') return false
  return chainId === arcTestnet.id
}

const SESSION_KEY = 'lumarc-passkey-credential-v1'

let memory: P256Credential | null = null

/** The signed-in passkey for this tab, if any. */
export function getSessionCredential(): P256Credential | null {
  if (memory) return memory
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as P256Credential
    if (typeof parsed?.id !== 'string' || typeof parsed?.publicKey !== 'string') return null
    memory = parsed
    return parsed
  } catch {
    return null
  }
}

export function setSessionCredential(c: P256Credential | null): void {
  memory = c
  try {
    if (c) sessionStorage.setItem(SESSION_KEY, JSON.stringify(c))
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Storage can be blocked: the credential still works for this page load.
  }
}

/** Asks the device for a passkey: creates one (register) or uses an existing one (login). Opens the system prompt. */
export async function requestPasskey(mode: 'register' | 'login', username?: string): Promise<P256Credential> {
  const cfg = circleConfig()
  if (!cfg) throw new Error('The passkey wallet is not set up on this site.')
  const sdk = await import('@circle-fin/modular-wallets-core')
  const transport = sdk.toPasskeyTransport(cfg.clientUrl, cfg.clientKey)
  const credential = await sdk.toWebAuthnCredential(mode === 'register' ? { transport, mode: sdk.WebAuthnMode.Register, username: (username ?? '').trim() } : { transport, mode: sdk.WebAuthnMode.Login })
  return credential
}

/** The smart account and bundler for one chain. Built on first use and reused. */
async function buildAccount(credential: P256Credential, chainId: number): Promise<CircleAccountHandle> {
  const cfg = circleConfig()
  const target = CIRCLE_CHAINS[chainId as keyof typeof CIRCLE_CHAINS]
  if (!cfg || !target) throw new Error(`The passkey wallet does not support chain ${chainId}.`)
  const [sdk, aa] = await Promise.all([import('@circle-fin/modular-wallets-core'), import('viem/account-abstraction')])
  const transport = sdk.toModularTransport(`${cfg.clientUrl}/${target.path}`, cfg.clientKey)
  const client = createPublicClient({ chain: target.chain, transport })
  const account = await sdk.toCircleSmartAccount({ client, owner: aa.toWebAuthnAccount({ credential }) })
  const bundler = aa.createBundlerClient({ chain: target.chain, transport, account })
  return {
    address: account.address,
    signMessage: (message) => account.signMessage({ message }),
    signTypedData: (typedData) => account.signTypedData(typedData as never),
    async sendCalls(calls, { sponsor }) {
      const hash = await bundler.sendUserOperation({
        account,
        calls: calls.map((c) => ({ to: c.to, data: c.data, value: c.value ?? 0n })),
        paymaster: sponsor ? true : undefined,
      })
      const { receipt } = await bundler.waitForUserOperationReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('The transaction failed on chain.')
      return receipt.transactionHash
    },
  }
}

/** The provider the wagmi connector hands out. One account per chain, created on demand from the signed-in credential. */
export function createCircleProvider(initialChainId: number, rpcUrls: Record<number, string>): CirclePasskeyProvider {
  const accounts = new Map<number, Promise<CircleAccountHandle>>()
  const deps: CircleProviderDeps = {
    supportedChains: CIRCLE_CHAIN_IDS,
    sponsor: (chainId) => sponsorGas(chainId),
    account: (chainId) => {
      const credential = getSessionCredential()
      if (!credential) return Promise.reject(new Error('Sign in with your passkey first.'))
      let p = accounts.get(chainId)
      if (!p) {
        p = buildAccount(credential, chainId)
        // A failed build must not be cached, or one network blip would break the wallet until a reload.
        p.catch(() => accounts.delete(chainId))
        accounts.set(chainId, p)
      }
      return p
    },
    rpc: async (chainId, method, params) => {
      const url = rpcUrls[chainId]
      if (!url) throw new Error(`No RPC endpoint for chain ${chainId}.`)
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } }
      if (json.error) throw new Error(json.error.message ?? 'RPC error')
      return json.result
    },
  }
  return new CirclePasskeyProvider(deps, initialChainId)
}
