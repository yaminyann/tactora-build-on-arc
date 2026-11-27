import { useEffect, useRef, useState } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { BookOpen, ChevronDown, Menu, Moon, Settings as SettingsIcon, ShieldCheck, Sun, X } from 'lucide-react'
import { clsx } from 'clsx'
import { BRAND } from '@/brand'
import { ConnectWalletButton } from '@/wallet/ConnectDialog'
import { NETWORK_LIST, type NetworkConfig } from '@/trading/networks'
import { useSettings, type Page } from '@/trading/settings'
import { useBalances } from '@/trading/hooks'
import { useContractState } from '@/trading/admin'
import { usePlatformAdmin } from '@/trading/platform'
import { formatToken } from '@/trading/math'
import { Logo } from './Logo'
import { Skeleton } from './ui'

/** The page links shared by the desktop header and the mobile tab bar, in one place. */
export function usePageLinks(): { id: Page; label: string }[] {
  const { isConnected } = useAccount()
  const links: { id: Page; label: string }[] = [
    { id: 'trade', label: 'Trade' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'agent', label: 'Agent' },
  ]
  // The landing page is for visitors. Once a wallet is connected the app opens on Trade.
  return isConnected ? links : [{ id: 'home', label: 'Home' }, ...links]
}

const iconBtn = 'press grid h-10 w-10 place-items-center rounded-lg border border-control bg-panel text-ink hover:bg-raised'

export function Header({ network }: { network: NetworkConfig }) {
  const s = useSettings()
  const { address, chainId, isConnected } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  const balances = useBalances(network, address)
  const usdc = balances.data?.[network.quote.address.toLowerCase()]
  const wrongChain = isConnected && chainId !== network.chainId
  // Offered only to the contract owner (or the wallet it offered ownership to). The contract enforces access either way.
  const contract = useContractState(network).data
  const me = address?.toLowerCase()
  const isAdmin = Boolean(me && contract && (me === contract.owner.toLowerCase() || me === contract.pendingOwner?.toLowerCase()))
  // The server decides who is a platform admin; the link is only a convenience for that wallet.
  const isPlatformAdmin = Boolean(usePlatformAdmin(address).data?.admin)
  const nav = [...usePageLinks().filter((l) => l.id !== 'home'), ...(isAdmin ? [{ id: 'admin' as Page, label: 'Admin' }] : []), ...(isPlatformAdmin ? [{ id: 'platform' as Page, label: 'Platform' }] : [])]

  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu])

  const go = (p: Page) => {
    setMenu(false)
    s.setPage(p)
  }
  const balanceText = balances.isLoading ? null : `${formatToken(usdc ?? 0n, network.quote.decimals, 2)} USDC`

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-2 px-3 sm:px-6 md:h-16 md:gap-6 lg:px-8">
        <button onClick={() => go(isConnected ? 'trade' : 'home')} aria-label={`${BRAND.name}, ${isConnected ? 'open Trade' : 'home'}`} className="flex min-h-[44px] shrink-0 items-center rounded-lg pr-1">
          <Logo size={26} />
        </button>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Pages">
          {nav.map((p) => {
            const active = s.page === p.id
            return (
              <button
                key={p.id}
                onClick={() => go(p.id)}
                aria-current={active ? 'page' : undefined}
                className={clsx('relative min-h-[40px] rounded-lg px-3.5 text-sm font-semibold', active ? 'bg-raised text-ink' : 'text-mute hover:bg-raised/70 hover:text-ink')}
              >
                {p.label}
                {active && <span className="absolute inset-x-3.5 -bottom-[13px] hidden h-0.5 rounded-full bg-accent lg:block" aria-hidden="true" />}
              </button>
            )
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          <div className="relative">
            <label className="sr-only" htmlFor="network">
              Network
            </label>
            <select
              id="network"
              value={s.networkKey}
              onChange={(e) => s.setNetworkKey(e.target.value as typeof s.networkKey)}
              className="min-h-[40px] cursor-pointer appearance-none rounded-lg border border-control bg-panel py-0 pl-6 pr-6 text-xs font-semibold text-ink hover:bg-raised sm:pl-7 sm:pr-7"
            >
              {NETWORK_LIST.map((n) => (
                <option key={n.key} value={n.key}>
                  {n.isTestnet ? 'Testnet' : 'Mainnet'}
                </option>
              ))}
            </select>
            <span className={clsx('pointer-events-none absolute left-2.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full', network.isTestnet ? 'bg-warn' : 'bg-up')} aria-hidden="true" />
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mute" aria-hidden="true" />
          </div>

          {isConnected && (
            <div className="num sensitive hidden min-h-[40px] items-center rounded-lg border border-line bg-panel px-3 text-xs font-medium lg:flex" title="USDC balance (also your gas balance on Arc)">
              {balanceText ?? <Skeleton className="h-3 w-14" />}
            </div>
          )}

          {wrongChain && (
            <button onClick={() => switchChain({ chainId: network.chainId })} disabled={isPending} className="press min-h-[40px] whitespace-nowrap rounded-lg bg-down px-3 text-xs font-semibold text-canvas">
              Switch network
            </button>
          )}

          <ConnectWalletButton className="min-h-[40px] rounded-lg px-3 text-xs hover:brightness-110 sm:px-3.5" />

          <button aria-label="Switch between light and dark" onClick={s.toggleTheme} className={clsx(iconBtn, 'hidden md:grid')}>
            {s.theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            aria-label="Open settings"
            aria-current={s.page === 'settings' ? 'page' : undefined}
            onClick={() => go('settings')}
            className={clsx(iconBtn, 'hidden md:grid', s.page === 'settings' && 'border-transparent bg-accent text-accent-ink hover:bg-accent')}
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
          <button aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu} aria-controls="mobile-menu" onClick={() => setMenu((v) => !v)} className={clsx(iconBtn, 'md:hidden')}>
            {menu ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {menu && (
        <>
          <div className="fixed inset-0 top-14 z-30 bg-black/50 md:hidden" onClick={() => setMenu(false)} aria-hidden="true" />
          <div id="mobile-menu" ref={menuRef} className="absolute inset-x-0 top-full z-40 border-b border-line bg-panel p-3 shadow-hard md:hidden">
            <div className="mx-auto max-w-md space-y-1">
              {isConnected && (
                <div className="flex min-h-[48px] items-center justify-between rounded-lg bg-raised px-3 text-sm">
                  <span className="text-mute">USDC balance</span>
                  <span className="num sensitive font-semibold">{balanceText ?? '...'}</span>
                </div>
              )}
              {nav.filter((l) => l.id === 'admin' || l.id === 'platform').map((p) => (
                <button key={p.id} onClick={() => go(p.id)} className="flex min-h-[48px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold hover:bg-raised">
                  <ShieldCheck className="h-4 w-4 text-brand" /> {p.label}
                </button>
              ))}
              <button onClick={() => go('settings')} className="flex min-h-[48px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold hover:bg-raised">
                <SettingsIcon className="h-4 w-4 text-brand" /> Settings
              </button>
              <button
                onClick={() => {
                  s.toggleTheme()
                  setMenu(false)
                }}
                className="flex min-h-[48px] w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold hover:bg-raised"
              >
                {s.theme === 'dark' ? <Sun className="h-4 w-4 text-brand" /> : <Moon className="h-4 w-4 text-brand" />}
                {s.theme === 'dark' ? 'Light theme' : 'Dark theme'}
              </button>
              <a href={BRAND.links.docs} target="_blank" rel="noopener noreferrer" className="flex min-h-[48px] w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold hover:bg-raised">
                <BookOpen className="h-4 w-4 text-brand" /> Documentation
              </a>
            </div>
          </div>
        </>
      )}
    </header>
  )
}
