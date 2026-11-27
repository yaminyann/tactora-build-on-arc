import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ExternalLink, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { TokenBase } from './TokenIcon'
import type { NetworkConfig, TokenInfo } from '@/trading/networks'
import type { MarketState } from '@/trading/market'
import { useNowSeconds, type OracleState } from '@/trading/hooks'
import { formatPrice18 } from '@/trading/math'
import { fmtNum, fmtPct, priceFmt } from '@/trading/format'
import { Skeleton } from './ui'

/** Whether a token can be used for orders and DCA: the order contract needs a price feed for it. */
export type FeedMap = Record<string, OracleState | undefined>

export function TokenSelector({ network, bases, value, onChange, feeds }: { network: NetworkConfig; bases: TokenInfo[]; value: TokenInfo | undefined; onChange: (t: TokenInfo) => void; feeds?: FeedMap }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchable = bases.length > 8
  const needle = query.trim().toLowerCase()
  const shown = needle ? bases.filter((t) => t.symbol.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle) || t.address.toLowerCase() === needle) : bases
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const disabled = bases.length <= 1
  const supportsOrders = (t: TokenInfo) => feeds?.[t.address.toLowerCase()]?.status === 'ok'
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className="press flex min-h-[48px] items-center gap-2 border border-line bg-panel px-3 text-left shadow-hard-sm enabled:hover:bg-raised disabled:cursor-default"
      >
        {value ? (
          <>
            <TokenBase token={value} />
            <span className="font-display text-lg">{value.symbol}</span>
            <span className="text-sm text-mute">/ {network.quote.symbol}</span>
          </>
        ) : (
          <span className="text-sm text-mute">No tokens configured</span>
        )}
        {!disabled && <ChevronDown className="h-4 w-4 text-mute" />}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[min(22rem,calc(100vw-2rem))] border border-line bg-panel p-1 shadow-hard">
          {searchable && (
            <label className="mb-1 flex items-center gap-2 border border-line bg-raised px-2.5">
              <Search className="h-3.5 w-3.5 text-mute" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${bases.length} tokens`}
                aria-label="Search tokens"
                className="min-h-[40px] w-full bg-transparent text-sm outline-none placeholder:text-mute/60"
              />
            </label>
          )}
          <ul role="listbox" className="thin-scroll max-h-80 overflow-y-auto">
            {shown.length === 0 && <li className="px-3 py-4 text-center text-xs text-mute">No token matches "{query}".</li>}
            {shown.map((t) => (
              <li key={t.address}>
                <button
                  role="option"
                  aria-selected={value?.address === t.address}
                  onClick={() => {
                    onChange(t)
                    setOpen(false)
                    setQuery('')
                  }}
                  className={clsx('flex min-h-[44px] w-full items-center gap-2.5 px-2.5 text-left text-sm hover:bg-raised', value?.address === t.address && 'bg-raised')}
                >
                  <TokenBase token={t} />
                  <span className="font-semibold">{t.symbol}</span>
                  <span className="min-w-0 truncate text-xs text-mute">{t.name}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {supportsOrders(t) && <span className="border border-line bg-accent px-1 py-0.5 font-mono text-[10px] font-semibold text-accent-ink">Orders</span>}
                    {t.isTest ? (
                      <span className="border border-line bg-warn px-1.5 py-0.5 font-mono text-[10px] font-semibold text-canvas">TEST</span>
                    ) : (
                      <span className="num text-[10px] text-mute" title={t.address}>
                        {t.address.slice(0, 6)}…{t.address.slice(-4)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('min-w-0 px-4 py-3', className)}>
      <div className="text-[11px] font-semibold text-mute">{label}</div>
      <div className="num mt-0.5 truncate text-sm">{children}</div>
    </div>
  )
}

/** Compact USD amount: 9,697,663 becomes 9.70M. */
function compactUsd(n: number): string {
  if (!(n > 0)) return '-'
  return '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)
}

/**
 * One bar for the selected market: the token picker, the price, and the numbers that matter, laid out in equal cells
 * so the row fills its width on desktop and wraps cleanly on a phone.
 */
export function MarketHeader({
  selector,
  market,
  oracle,
  oracleLoading,
  indicative,
}: {
  selector: ReactNode
  market: MarketState
  oracle: OracleState | undefined
  oracleLoading: boolean
  indicative?: { price18: bigint | null; loading: boolean }
}) {
  const s = market.stats
  const up = (s?.changePct ?? 0) >= 0
  const now = useNowSeconds()
  const age = oracle?.status === 'ok' ? Math.max(0, now - oracle.updatedAt) : null
  const hasMarket = market.kind !== null && !market.noPool && !market.error
  const priceLabel = market.kind === 'dex' ? 'Pool price (USD)' : market.kind === 'cex' ? 'Reference price' : 'Swap price (10 USDC)'
  const showOracle = oracle?.status === 'ok' || oracleLoading

  return (
    <div className="border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line p-3 sm:px-4">
        {selector}
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-mute">{priceLabel}</div>
          {hasMarket && market.last !== null ? (
            <div className="flex items-baseline gap-2">
              <span className="num text-3xl font-semibold leading-none">{priceFmt(market.last)}</span>
              {s && <span className={clsx('num text-sm font-semibold', up ? 'text-up' : 'text-down')}>{fmtPct(s.changePct)}</span>}
            </div>
          ) : market.loading ? (
            <Skeleton className="mt-1 h-8 w-32" />
          ) : indicative?.loading ? (
            <Skeleton className="mt-1 h-8 w-32" />
          ) : (
            <div className="num text-3xl font-semibold leading-none">{indicative?.price18 ? formatPrice18(indicative.price18, 6) : '-'}</div>
          )}
        </div>
        {market.pool?.url && (
          <a href={market.pool.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold underline underline-offset-2 hover:bg-accent hover:text-accent-ink">
            {market.pool.dex} pool <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {hasMarket && s ? (
        <div className="grid grid-cols-2 divide-x divide-line sm:grid-cols-4 [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-line sm:[&>*:nth-child(n+3)]:border-t-0">
          <Cell label="24h high">{priceFmt(s.high)}</Cell>
          <Cell label="24h low">{priceFmt(s.low)}</Cell>
          <Cell label={market.kind === 'dex' ? '24h volume (USD)' : '24h volume'}>{market.kind === 'dex' ? compactUsd(s.volume) : fmtNum(s.volume, 0)}</Cell>
          {market.kind === 'dex' && market.pool ? (
            <Cell label="Pool liquidity">{compactUsd(market.pool.liquidityUsd)}</Cell>
          ) : (
            <Cell label="Onchain oracle">
              {oracleLoading ? (
                <Skeleton className="h-4 w-20" />
              ) : oracle?.status === 'ok' ? (
                <>
                  {formatPrice18(oracle.price18)} <span className="text-xs text-mute">{age !== null ? (age < 90 ? `${age}s` : `${Math.round(age / 60)}m`) : ''}</span>
                </>
              ) : (
                <span className="text-mute">{oracle?.status === 'no-feed' ? 'No feed' : oracle?.status === 'no-contract' ? 'Not configured' : '-'}</span>
              )}
            </Cell>
          )}
        </div>
      ) : (
        <div className="px-4 py-3 text-xs text-mute">
          {market.error
            ? 'Market data is unavailable right now. The swap form still shows a live aggregator quote for your exact size.'
            : market.noPool
              ? 'No DEX pool with liquidity was found for this token, so there is no chart. The price above is the live aggregator quote for 10 USDC.'
              : market.loading
                ? 'Loading market data...'
                : 'No market data for this asset. The price above is the live aggregator quote for 10 USDC.'}
        </div>
      )}

      {showOracle && market.kind === 'dex' && (
        <div className="border-t border-line px-4 py-2 text-xs text-mute">
          Onchain oracle:{' '}
          <span className="num text-ink">{oracle?.status === 'ok' ? formatPrice18(oracle.price18) : oracleLoading ? '...' : '-'}</span> (the price orders use)
        </div>
      )}
    </div>
  )
}
