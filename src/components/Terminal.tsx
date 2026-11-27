import { useState } from 'react'
import { clsx } from 'clsx'
import type { NetworkConfig, TokenInfo } from '@/trading/networks'
import { useSettings } from '@/trading/settings'
import { useOracle, useOraclePrices } from '@/trading/hooks'
import { useDexMarket, useMarket, type Timeframe } from '@/trading/market'
import { useIndicativePrice, useTokenList } from '@/trading/tokens'
import { Button, Panel, Segmented, Skeleton } from './ui'
import { MarketHeader, TokenSelector } from './PairBar'
import { PriceChart } from './PriceChart'
import { TradePanel } from './TradePanel'
import { OrderTabs } from './OrderTabs'
import { NetworkBanner } from './NetworkBanner'
import { TestnetTools } from './TestnetTools'
import { AccountPanel } from './AccountPanel'

type Pane = 'order' | 'chart' | 'orders' | 'account'

export function Terminal({ network }: { network: NetworkConfig }) {
  const { setNetworkKey, defaultTimeframe } = useSettings()
  const [baseAddr, setBaseAddr] = useState<string | undefined>()
  const [tf, setTf] = useState<Timeframe>(defaultTimeframe)
  // Phones show one section at a time, like an app. Wide screens show two columns.
  const [pane, setPane] = useState<Pane>('order')
  const only = (id: Pane) => (pane === id ? '' : 'hidden lg:block')
  const list = useTokenList(network)
  const bases = list.tokens
  // Derived: an address picked on another network falls back to this network's first token.
  const base: TokenInfo | undefined = bases.find((t) => t.address === baseAddr) ?? bases[0]

  // Market data: Coinbase for the few assets it lists, otherwise the token's deepest real pool on the chain.
  const hasCex = Boolean(base?.referenceProduct)
  const cex = useMarket(base?.referenceProduct, tf)
  const dex = useDexMarket(network.chainId, base?.address, tf, !hasCex && !network.isTestnet && Boolean(base))
  const market = hasCex ? cex : dex
  const hasChart = market.kind !== null && !market.noPool
  const oracle = useOracle(network, base)
  const feeds = useOraclePrices(network, network.ordersAddress ? bases : [])
  const indicative = useIndicativePrice(network, base, !network.isTestnet && !(market.kind !== null && market.last !== null && !market.error))

  // Nothing to trade yet: say why, instead of a shell of disabled panels.
  if (!base) {
    return (
      <div className="mx-auto max-w-xl space-y-4 pt-6">
        <NetworkBanner network={network} />
        <Panel className="p-8 text-center">
          {list.loading ? (
            <div className="space-y-3">
              <Skeleton className="mx-auto h-5 w-48" />
              <Skeleton className="mx-auto h-4 w-64" />
            </div>
          ) : list.error ? (
            <>
              <h1 className="text-2xl">Could not load the token list</h1>
              <p className="mx-auto mt-2 max-w-sm text-sm text-mute">The backend could not reach the token registry. Check that the API is running, then retry.</p>
              <Button variant="primary" className="mt-5" onClick={list.retry}>
                Retry
              </Button>
            </>
          ) : (
            <>
              <h1 className="text-2xl">Trading is not enabled on {network.label} yet</h1>
              <p className="mx-auto mt-2 max-w-sm text-sm text-mute">No tokens are available for this network. Switch to Arc Testnet to try every order type with test tokens.</p>
              <Button variant="primary" className="mt-5" onClick={() => setNetworkKey('arc-testnet')}>
                Use Arc Testnet
              </Button>
            </>
          )}
        </Panel>
      </div>
    )
  }

  const sourceLabel =
    market.kind === 'cex'
      ? `Reference chart from Coinbase ${base.referenceProduct}. It is not an Arc pool price.`
      : market.kind === 'dex' && market.pool
        ? `Chart of the deepest ${market.pool.dex} pool on Arc (${market.pool.symbol}/${market.pool.quoteSymbol}), in USD. Data from DexScreener and GeckoTerminal.`
        : null

  return (
    <div className="space-y-3">
      <NetworkBanner network={network} />
      <div className="lg:hidden">
        <Segmented className="w-full" value={pane} onChange={setPane} options={[{ id: 'order', label: 'Order' }, { id: 'chart', label: 'Chart' }, ...(network.ordersAddress ? [{ id: 'orders' as const, label: 'Orders' }] : []), { id: 'account', label: 'Account' }]} />
      </div>

      <MarketHeader
        selector={<TokenSelector network={network} bases={bases} value={base} onChange={(t) => setBaseAddr(t.address)} feeds={feeds} />}
        market={market}
        oracle={oracle.data}
        oracleLoading={oracle.isLoading}
        indicative={{ price18: indicative.data ?? null, loading: indicative.isLoading }}
      />

      {/* Two independent columns, so neither leaves a hole under the shorter one. On phones both dissolve into one list that shows a pane at a time. */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="contents lg:block lg:min-w-0 lg:space-y-4">
          <div className={clsx('order-2 min-w-0', only('chart'))}>
            {hasChart ? (
              <Panel>
                <PriceChart
                  candles={market.candles}
                  loading={market.loading}
                  error={market.error}
                  timeframe={tf}
                  onTimeframe={setTf}
                  sourceLabel={sourceLabel}
                  live={market.live}
                  liveLabel={market.kind === 'dex' ? 'Auto-refresh' : 'Live'}
                  lastPrice={market.last}
                />
              </Panel>
            ) : (
              <Panel className="p-5 text-sm">
                <h2 className="text-lg">No chart for {base.symbol}</h2>
                <p className="mt-1 max-w-xl text-mute">
                  {network.isTestnet
                    ? `${base.symbol} is a test token that follows a public test price, so there is no market to chart. Use the Testnet tools to move its price.`
                    : market.error
                      ? 'The chart service did not answer. The swap form still shows a live aggregator quote and route for your exact size.'
                      : market.loading
                        ? 'Loading market data...'
                        : `No DEX pool with liquidity was found for ${base.symbol}, so there is no price history to draw. You can still swap it: the form shows a live aggregator quote and the route for your exact size.`}
                </p>
              </Panel>
            )}
          </div>

          {network.ordersAddress && (
            <div className={clsx('order-4 min-w-0', only('orders'))}>
              <OrderTabs network={network} />
            </div>
          )}
        </div>

        <div className="contents lg:thin-scroll lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6rem)] lg:space-y-4 lg:overflow-y-auto lg:pr-0.5">
          <div className={clsx('order-1 min-w-0', only('order'))}>
            <TradePanel network={network} base={base} oracle={oracle.data} />
          </div>
          <aside className={clsx('order-5 min-w-0 space-y-4', only('account'))}>
            <AccountPanel network={network} />
            <TestnetTools network={network} base={base} />
          </aside>
        </div>
      </div>
    </div>
  )
}
