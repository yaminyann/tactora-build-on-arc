import { ChartCandlestick, Command, House, SlidersHorizontal, Wallet } from 'lucide-react'
import { clsx } from 'clsx'
import { useSettings, type Page } from '@/trading/settings'
import { usePageLinks } from './Header'

const ICONS: Partial<Record<Page, typeof House>> = {
  home: House,
  trade: ChartCandlestick,
  dashboard: Wallet,
  agent: Command,
  settings: SlidersHorizontal,
}

/**
 * The phone's tab bar. Every tab has an icon and a label, is at least 56px tall, and the bar reserves
 * the safe-area inset so it never sits under a home indicator. The page adds matching bottom padding.
 */
export function BottomNav() {
  const { page, setPage } = useSettings()
  const tabs = [...usePageLinks(), { id: 'settings' as Page, label: 'Settings' }]
  return (
    <nav aria-label="Pages" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/95 backdrop-blur-sm md:hidden">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((t) => {
          const Icon = ICONS[t.id] ?? House
          const active = page === t.id
          return (
            <li key={t.id} className="px-0.5 py-1">
              <button
                onClick={() => setPage(t.id)}
                aria-current={active ? 'page' : undefined}
                className={clsx('flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-semibold', active ? 'bg-raised text-brand' : 'text-mute')}
              >
                <Icon className="h-5 w-5" />
                {t.label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
