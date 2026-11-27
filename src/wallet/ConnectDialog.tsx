import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { ConnectKitButton, useModal } from 'connectkit'
import { useAccount, useConnect } from 'wagmi'
import { Fingerprint, Wallet } from 'lucide-react'
import { clsx } from 'clsx'
import { Button, Modal, Notice } from '@/components/ui'
import { NETWORKS } from '@/trading/networks'
import { useSettings } from '@/trading/settings'
import { circleEnabled, requestPasskey, setSessionCredential, sponsorGas } from './circle'
import { CIRCLE_CONNECTOR_ID } from './circleConnector'

interface Dialog {
  open: () => void
}

const Ctx = createContext<Dialog>({ open: () => undefined })

/** Opens the "Connect a wallet" dialog from anywhere. */
export function useConnectDialog(): Dialog {
  return useContext(Ctx)
}

/** Plain-words messages for the ways a passkey prompt can fail. */
export function passkeyErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : ''
  const msg = e instanceof Error ? e.message : ''
  if (name === 'NotAllowedError') return 'The fingerprint prompt was cancelled or timed out. Try again.'
  if (name === 'InvalidStateError') return 'A passkey for this name already exists on this device. Choose "Sign in" instead.'
  if (name === 'SecurityError') return 'This passkey belongs to a different website address. The operator must add this address as the passkey domain in the Circle Console.'
  if (name === 'NotSupportedError') return 'This browser or device does not support passkeys.'
  if (/401|403|unauthor|client key|invalid credentials/i.test(msg)) return 'Circle rejected the Client Key. The operator must check VITE_CIRCLE_CLIENT_KEY and the allowed domain in the Circle Console.'
  return (msg.split('Details:')[0].trim() || 'Could not use the passkey. Try again.').slice(0, 200)
}

function Choice({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="border border-line p-4">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h3 className="text-base">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function ConnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setOpen: openConnectKit } = useModal()
  const { connectAsync, connectors } = useConnect()
  const { networkKey } = useSettings()
  const network = NETWORKS[networkKey]
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<'register' | 'login' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const supported = typeof window !== 'undefined' && 'PublicKeyCredential' in window

  const passkey = async (mode: 'register' | 'login') => {
    setError(null)
    if (mode === 'register' && name.trim().length < 2) {
      setError('Give the new wallet a name of at least two letters, for example your first name.')
      return
    }
    setBusy(mode)
    try {
      const credential = await requestPasskey(mode, name)
      setSessionCredential(credential)
      const connector = connectors.find((c) => c.id === CIRCLE_CONNECTOR_ID)
      if (!connector) throw new Error('The passkey wallet is not available.')
      await connectAsync({ connector, chainId: network.chainId })
      onClose()
    } catch (e) {
      setSessionCredential(null)
      setError(passkeyErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Connect a wallet" wide>
      <div className="space-y-3">
        <Choice icon={<Fingerprint className="h-5 w-5" />} title="Passkey wallet">
          {circleEnabled ? (
            <div className="space-y-3">
              <p className="text-sm text-mute">
                Use your fingerprint, Face ID or a security key. No extension and no seed phrase, so it works in a phone browser. The key never leaves your device&apos;s secure hardware, and every transaction asks for your fingerprint.
              </p>
              {network.isTestnet ? (
                sponsorGas(network.chainId) && <p className="text-xs text-mute">Network fees on testnet are paid for you.</p>
              ) : (
                <Notice tone="warn" title="Mainnet uses real funds">
                  {sponsorGas(network.chainId) ? 'Network fees are sponsored by this site.' : 'This wallet pays network fees from its own USDC balance, so send a little USDC to its address first.'}
                </Notice>
              )}
              {!supported ? (
                <Notice tone="warn" title="Passkeys are not available here">
                  This browser does not support passkeys. Use a current Chrome, Safari, Edge or Firefox over https.
                </Notice>
              ) : (
                <>
                  <label className="block text-xs font-semibold">
                    Name for a new wallet
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={40}
                      autoComplete="username webauthn"
                      placeholder="for example: amina"
                      className="mt-1 min-h-[44px] w-full border border-line bg-panel px-3 text-sm font-normal placeholder:text-mute focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button variant="primary" disabled={busy !== null} loading={busy === 'register'} onClick={() => void passkey('register')}>
                      Create wallet
                    </Button>
                    <Button disabled={busy !== null} loading={busy === 'login'} onClick={() => void passkey('login')}>
                      Sign in
                    </Button>
                  </div>
                </>
              )}
              {error && (
                <Notice tone="error" title="Could not continue">
                  {error}
                </Notice>
              )}
            </div>
          ) : (
            <p className="text-sm text-mute">Not set up on this site yet. The operator can switch it on with a free Circle Client Key (see docs/api-keys.md).</p>
          )}
        </Choice>

        <Choice icon={<Wallet className="h-5 w-5" />} title="Browser wallet">
          <p className="mb-3 text-sm text-mute">MetaMask, Rabby, Coinbase Wallet, or the wallet built into your phone browser.</p>
          <Button
            className="w-full"
            onClick={() => {
              onClose()
              openConnectKit(true)
            }}
          >
            Choose a browser wallet
          </Button>
        </Choice>
      </div>
    </Modal>
  )
}

export function ConnectDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openDialog = useCallback(() => setOpen(true), [])
  const value = useMemo(() => ({ open: openDialog }), [openDialog])
  return (
    <Ctx.Provider value={value}>
      {children}
      <ConnectDialog open={open} onClose={() => setOpen(false)} />
    </Ctx.Provider>
  )
}

/** The one connect button. Disconnected it opens the dialog; connected it shows the address and opens the account view. */
export function ConnectWalletButton({ className, label = 'Connect wallet' }: { className?: string; label?: string }) {
  const dialog = useConnectDialog()
  const { isConnected } = useAccount()
  return (
    <ConnectKitButton.Custom>
      {({ show, truncatedAddress }) => (
        <button onClick={isConnected ? show : dialog.open} className={clsx('press whitespace-nowrap rounded-lg border border-transparent bg-accent font-semibold text-accent-ink', className)}>
          {isConnected ? truncatedAddress : label}
        </button>
      )}
    </ConnectKitButton.Custom>
  )
}
