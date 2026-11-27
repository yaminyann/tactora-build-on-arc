/**
 * An EIP-1193 provider backed by a Circle passkey smart account.
 *
 * The user's key lives in their device's secure hardware (fingerprint, Face ID, a security key) and never reaches this
 * page. The account is a smart contract wallet, so a "transaction" here is a user operation sent through Circle's
 * bundler. This class holds only the translation between the two; the real account and network calls are injected,
 * so it can be tested without a browser or a Circle key.
 *
 * Methods that are not about the user (reads, gas estimates, receipts) go to the chain's normal RPC.
 */
import type { Address, Hex } from 'viem'

export interface Call {
  to: Address
  data?: Hex
  value?: bigint
}

export interface CircleAccountHandle {
  address: Address
  signMessage(message: string | { raw: Hex }): Promise<Hex>
  signTypedData(typedData: unknown): Promise<Hex>
  /** Sends the calls as one user operation and returns the hash of the transaction that included it. */
  sendCalls(calls: Call[], opts: { sponsor: boolean }): Promise<Hex>
}

export interface CircleProviderDeps {
  /** The account for a chain. Throws for a chain the account does not support. */
  account(chainId: number): Promise<CircleAccountHandle>
  /** A plain JSON-RPC request to the chain's public endpoint. */
  rpc(chainId: number, method: string, params: unknown[]): Promise<unknown>
  /** Whether network fees are paid by the app's Gas Station policy instead of the user. */
  sponsor(chainId: number): boolean
  supportedChains: readonly number[]
}

export class ProviderRpcError extends Error {
  constructor(
    message: string,
    public code: number,
  ) {
    super(message)
  }
}

type Listener = (...args: unknown[]) => void

const hex = (n: number) => `0x${n.toString(16)}`

/** WebAuthn reports a cancelled or timed-out prompt as NotAllowedError. Wallets report the same thing as code 4001. */
export function mapPasskeyError(e: unknown): Error {
  const name = e instanceof Error ? e.name : ''
  const msg = e instanceof Error ? e.message : String(e)
  if (name === 'NotAllowedError' || /user rejected|cancel/i.test(msg)) return new ProviderRpcError('User rejected the request.', 4001)
  if (name === 'SecurityError') return new ProviderRpcError('This passkey belongs to a different website address. Check the passkey domain in the Circle Console.', 4100)
  return e instanceof Error ? e : new Error(msg)
}

export class CirclePasskeyProvider {
  private listeners = new Map<string, Set<Listener>>()
  private chainId: number

  constructor(
    private readonly deps: CircleProviderDeps,
    initialChainId: number,
  ) {
    if (!deps.supportedChains.includes(initialChainId)) throw new ProviderRpcError(`Chain ${initialChainId} is not supported by the passkey wallet.`, 4902)
    this.chainId = initialChainId
  }

  get currentChainId(): number {
    return this.chainId
  }

  on(event: string, fn: Listener) {
    const set = this.listeners.get(event) ?? new Set()
    set.add(fn)
    this.listeners.set(event, set)
    return this
  }

  removeListener(event: string, fn: Listener) {
    this.listeners.get(event)?.delete(fn)
    return this
  }

  private emit(event: string, ...args: unknown[]) {
    for (const fn of this.listeners.get(event) ?? []) fn(...args)
  }

  async request({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> {
    switch (method) {
      case 'eth_chainId':
        return hex(this.chainId)
      case 'net_version':
        return String(this.chainId)
      case 'eth_accounts':
      case 'eth_requestAccounts':
        return [(await this.deps.account(this.chainId)).address]
      case 'wallet_switchEthereumChain': {
        const id = Number((params[0] as { chainId?: string } | undefined)?.chainId)
        if (!this.deps.supportedChains.includes(id)) throw new ProviderRpcError(`Chain ${id} is not supported by the passkey wallet.`, 4902)
        if (id !== this.chainId) {
          this.chainId = id
          this.emit('chainChanged', hex(id))
        }
        return null
      }
      case 'eth_sendTransaction': {
        const tx = params[0] as { to?: Address; data?: Hex; value?: string | number | bigint } | undefined
        if (!tx?.to) throw new ProviderRpcError('A transaction needs a destination address. Contract creation is not supported by the passkey wallet.', -32602)
        const account = await this.deps.account(this.chainId)
        try {
          return await account.sendCalls([{ to: tx.to, data: tx.data, value: tx.value === undefined ? 0n : BigInt(tx.value) }], { sponsor: this.deps.sponsor(this.chainId) })
        } catch (e) {
          throw mapPasskeyError(e)
        }
      }
      case 'personal_sign': {
        const account = await this.deps.account(this.chainId)
        try {
          return await account.signMessage({ raw: params[0] as Hex })
        } catch (e) {
          throw mapPasskeyError(e)
        }
      }
      case 'eth_signTypedData_v4': {
        const account = await this.deps.account(this.chainId)
        try {
          return await account.signTypedData(typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1])
        } catch (e) {
          throw mapPasskeyError(e)
        }
      }
      case 'eth_sign':
      case 'eth_signTransaction':
      case 'wallet_addEthereumChain':
        throw new ProviderRpcError(`${method} is not supported by the passkey wallet.`, 4200)
      default:
        return this.deps.rpc(this.chainId, method, params)
    }
  }
}
