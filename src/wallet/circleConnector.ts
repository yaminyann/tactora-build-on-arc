import { createConnector } from 'wagmi'
import type { Address } from 'viem'
import { createCircleProvider, getSessionCredential, setSessionCredential } from './circle'
import type { CirclePasskeyProvider } from './circleProvider'

export const CIRCLE_CONNECTOR_ID = 'circlePasskey'

/**
 * wagmi connector for the Circle passkey wallet. It cannot open the fingerprint prompt itself: the sign-in dialog does
 * that (see ConnectDialog) and stores the credential, and this connector then turns it into an account. Without a
 * credential for this tab, connecting fails with a clear message instead of a blank state.
 */
export function circlePasskey(opts: { rpcUrls: Record<number, string> }) {
  let provider: CirclePasskeyProvider | undefined

  return createConnector<CirclePasskeyProvider>((config) => {
    const hexId = (id: number) => `0x${id.toString(16)}`

    const ensureProvider = (chainId?: number): CirclePasskeyProvider => {
      if (!provider) {
        const start = chainId ?? config.chains[0].id
        provider = createCircleProvider(start, opts.rpcUrls)
        provider.on('chainChanged', (hex) => config.emitter.emit('change', { chainId: Number(hex) }))
      }
      return provider
    }

    return {
      id: CIRCLE_CONNECTOR_ID,
      name: 'Passkey wallet',
      type: CIRCLE_CONNECTOR_ID,
      async setup() {},
      async connect(parameters?: { chainId?: number }) {
        if (!getSessionCredential()) throw new Error('Sign in with your fingerprint first (Connect wallet, then Passkey wallet).')
        const p = ensureProvider(parameters?.chainId)
        if (parameters?.chainId && parameters.chainId !== p.currentChainId) await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId(parameters.chainId) }] })
        const accounts = (await p.request({ method: 'eth_accounts' })) as Address[]
        return { accounts, chainId: p.currentChainId } as never
      },
      disconnect() {
        setSessionCredential(null)
        provider = undefined
        return Promise.resolve()
      },
      async getAccounts() {
        if (!getSessionCredential()) return []
        return (await ensureProvider().request({ method: 'eth_accounts' })) as Address[]
      },
      getChainId() {
        return Promise.resolve(ensureProvider().currentChainId)
      },
      getProvider() {
        return Promise.resolve(ensureProvider())
      },
      isAuthorized() {
        return Promise.resolve(getSessionCredential() !== null)
      },
      async switchChain({ chainId }) {
        const chain = config.chains.find((c) => c.id === chainId)
        if (!chain) throw new Error(`Chain ${chainId} is not configured.`)
        await ensureProvider().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId(chainId) }] })
        return chain
      },
      onAccountsChanged(accounts) {
        if (accounts.length === 0) this.onDisconnect()
        else config.emitter.emit('change', { accounts: accounts as Address[] })
      },
      onChainChanged(chain) {
        config.emitter.emit('change', { chainId: Number(chain) })
      },
      onDisconnect() {
        config.emitter.emit('disconnect')
        setSessionCredential(null)
        provider = undefined
      },
    }
  })
}
