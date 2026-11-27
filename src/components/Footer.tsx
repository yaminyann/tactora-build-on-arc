import { useState, type ReactNode } from 'react'
import { BRAND } from '@/brand'
import { NETWORKS } from '@/trading/networks'
import { useSettings } from '@/trading/settings'
import { useBackendHealth } from '@/trading/hooks'
import { Logo } from './Logo'
import { Modal } from './ui'

function Cell({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-mute">{label}</span>
      <span className="num flex items-center gap-1.5 font-semibold">
        {/* The dot marks a real state: backend reachable, keeper running. */}
        {tone && <span className={tone === 'up' ? 'h-2 w-2 rounded-full bg-up' : 'h-2 w-2 rounded-full bg-down'} aria-hidden="true" />}
        {value}
      </span>
    </div>
  )
}

function FooterLink({ href, children, onClick }: { href?: string; children: ReactNode; onClick?: () => void }) {
  const cls = 'inline-flex min-h-[44px] items-center text-sm text-mute hover:text-ink'
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  )
}

/**
 * Footer. Built around what exists: the wordmark, the links the project really has, and live status.
 * Social links appear only when their VITE_SOCIAL_* variable is set.
 */
export function Footer() {
  const { networkKey, setPage } = useSettings()
  const health = useBackendHealth()
  const [legal, setLegal] = useState<'risk' | 'terms' | 'privacy' | null>(null)
  const net = NETWORKS[networkKey]
  const keeper = health.data?.keeper

  return (
    <footer className="mt-12 pb-20 md:pb-0">
      <div className="border-t border-line bg-panel">
        <div className="mx-auto grid w-full max-w-[1600px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.2fr_1fr] lg:px-8">
          <div>
            <button onClick={() => setPage('home')} className="flex min-h-[44px] items-center rounded-lg" aria-label={`${BRAND.name} home`}>
              <Logo size={28} />
            </button>
            <p className="mt-3 max-w-md text-sm text-mute">
              A non-custodial trading platform for Arc. Funds stay in your wallet or in the order contract. {BRAND.name} never holds them.
            </p>
          </div>
          <div className="grid content-start gap-x-8 gap-y-1 sm:grid-cols-2">
            <FooterLink href={BRAND.links.docs}>Documentation</FooterLink>
            <FooterLink href={BRAND.links.github}>Source code</FooterLink>
            <FooterLink onClick={() => setLegal('risk')}>Risk notice</FooterLink>
            <FooterLink href={BRAND.links.terms} onClick={() => setLegal('terms')}>
              Terms
            </FooterLink>
            <FooterLink href={BRAND.links.privacy} onClick={() => setLegal('privacy')}>
              Privacy
            </FooterLink>
            {BRAND.links.support && <FooterLink href={BRAND.links.support}>Support</FooterLink>}
            {BRAND.links.x && <FooterLink href={BRAND.links.x}>X</FooterLink>}
            {BRAND.links.discord && <FooterLink href={BRAND.links.discord}>Discord</FooterLink>}
            {BRAND.links.telegram && <FooterLink href={BRAND.links.telegram}>Telegram</FooterLink>}
          </div>
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-8 gap-y-2 px-4 py-4 sm:px-6 lg:px-8">
            <Cell label="Backend" value={health.isSuccess ? 'Online' : health.isLoading ? 'Checking' : 'Offline'} tone={health.isSuccess ? 'up' : health.isLoading ? undefined : 'down'} />
            <Cell label="Network" value={net.label} />
            <Cell label="Keeper" value={keeper?.running ? 'Running' : 'Not running'} tone={keeper?.running ? 'up' : undefined} />
          </div>
        </div>
      </div>

      <Modal open={legal !== null} onClose={() => setLegal(null)} title={legal === 'terms' ? 'Terms of use' : legal === 'privacy' ? 'Privacy' : 'Risk notice'} wide>
        <div className="space-y-3 text-sm">
          {legal === 'risk' && (
            <>
              <p>Trading digital assets can lose all of its value. Prices move fast, and orders can fill at worse prices than expected.</p>
              <ul className="list-disc space-y-1.5 pl-5 text-mute">
                <li>The order contract is unaudited software on a young chain. Funds escrowed in it can be lost to bugs.</li>
                <li>Stop-loss and trailing orders follow a price oracle that can lag the market. A triggered order is not guaranteed to fill.</li>
                <li>Orders run only when a keeper submits them. If no keeper runs, nothing happens until one does.</li>
                <li>Tokens in the list can be routed, which is not an endorsement. Anyone can create a token, and many are worthless or hostile.</li>
                <li>The Agent turns text into transactions. Read each confirmation, and set limits you can afford to lose.</li>
                <li>Testnet assets have no value, and testnet prices are not market prices.</li>
              </ul>
            </>
          )}
          {legal === 'terms' && (
            <>
              <p>
                {BRAND.name} is software that helps you send transactions from your own wallet. It does not hold your keys or your funds, and it is not a broker, an exchange or an adviser.
              </p>
              <p>You are responsible for your transactions, for obeying the laws that apply to you, and for the tokens you choose to trade. The software is provided as is, without warranty.</p>
              <p className="rounded-lg border border-line bg-raised p-3 text-xs">This is a plain-language placeholder. Have a lawyer replace it, then set VITE_TERMS_URL so this link opens your real terms.</p>
            </>
          )}
          {legal === 'privacy' && (
            <>
              <p>The app stores your settings and recent swap hashes in your browser only. It reads public blockchain data for your wallet address.</p>
              <p>Quote requests, token lists and chart data go through this site's backend and on to KyberSwap, Coinbase market data and the RPC provider. They see your IP address and the request.</p>
              <p className="rounded-lg border border-line bg-raised p-3 text-xs">This is a plain-language placeholder. Have a lawyer replace it, then set VITE_PRIVACY_URL so this link opens your real policy.</p>
            </>
          )}
        </div>
      </Modal>
    </footer>
  )
}
