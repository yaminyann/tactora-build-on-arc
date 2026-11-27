import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Check, ExternalLink } from 'lucide-react'
import { BRAND } from '@/brand'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { NETWORKS } from '@/trading/networks'
import { useSettings } from '@/trading/settings'
import { useTokenList } from '@/trading/tokens'
import { setAgentPrefill } from '@/trading/agent/prefill'
import { parseCommand } from '@/trading/agent/parser'
import { interpretChat, type ChatContext } from '@/trading/agent/chat'
import { describeIntent } from '@/trading/agent/summary'
import { fetchCandles, fetchStats } from '@/trading/market'
import { fmtUsd, shortAddr } from '@/trading/format'
import { useBackendHealth } from '@/trading/hooks'
import { Reveal } from './motion'

/*
 * The page answers a visitor's questions in the order they ask them:
 *   1 Is this for me?  2 Can I trust you?  3 Do you get my problem?  4 What do I get?  5 How does it work?
 *   6 How much?  7 What if it goes wrong?
 * Everything on it is live or a plain statement about how the product works. The only numbers are read from the chain
 * config, the backend or a public market feed. No user counts, volume, partners, testimonials or audit claims.
 * The hero and the Agent section run the real command parser and chat rules in the browser; nothing is sent anywhere.
 */

const wrap = 'mx-auto w-full max-w-[1200px]'

function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-10 max-w-2xl sm:mb-14">
      <h2 className="min-w-0 break-words text-4xl leading-[1.08] sm:text-5xl">{title}</h2>
      {children && <p className="mt-4 text-base text-mute sm:text-lg">{children}</p>}
    </div>
  )
}

// ---------- live data the page reads ----------

/** The ETH reference price, so the sample prompts and their proposals use a real level, not an invented one. */
function useEthPrice() {
  return useQuery({ queryKey: ['landing-stats', 'ETH-USD'], queryFn: () => fetchStats('ETH-USD'), refetchInterval: 60_000, staleTime: 30_000, retry: 1 })
}

// ---------- the chart (real candles, drawn as one line) ----------

function PriceLine({ product, label }: { product: string; label: string }) {
  const q = useQuery({ queryKey: ['landing-candles', product], queryFn: () => fetchCandles(product, '1h', 1), refetchInterval: 120_000, staleTime: 60_000, retry: 1 })
  const stats = useQuery({ queryKey: ['landing-stats', product], queryFn: () => fetchStats(product), refetchInterval: 60_000, staleTime: 30_000, retry: 1 })
  const points = useMemo(() => (q.data ?? []).slice(-168).map((c) => c.close), [q.data])
  const W = 600
  const H = 140
  const pad = 6
  if (q.isLoading) return <div className="h-[140px] animate-pulse rounded-lg bg-raised motion-reduce:animate-none" aria-label="Loading chart" />
  if (q.isError || points.length < 2) return <p className="grid h-[140px] place-items-center rounded-lg bg-raised text-xs text-mute">Chart data is unavailable right now.</p>
  const lo = Math.min(...points)
  const hi = Math.max(...points)
  const span = hi - lo || 1
  const xy = points.map((p, i) => [pad + (i / (points.length - 1)) * (W - pad * 2), pad + (1 - (p - lo) / span) * (H - pad * 2)] as const)
  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)} ${H} L${xy[0][0].toFixed(1)} ${H} Z`
  const up = points[points.length - 1] >= points[0]
  return (
    <figure>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <figcaption className="text-xs text-mute">{label}, last 7 days</figcaption>
        {stats.data && (
          <span className="num text-sm font-semibold">
            {fmtUsd(stats.data.last, stats.data.last < 10 ? 4 : 2)}{' '}
            <span className={clsx('text-xs', stats.data.changePct >= 0 ? 'text-up' : 'text-down')}>
              {stats.data.changePct >= 0 ? '+' : ''}
              {(stats.data.changePct * 100).toFixed(2)}% today
            </span>
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[140px] w-full" role="img" aria-label={`${label} hourly closing price for the last 7 days, from ${fmtUsd(points[0])} to ${fmtUsd(points[points.length - 1])}`} preserveAspectRatio="none">
        <path d={area} className={up ? 'fill-up/10' : 'fill-down/10'} />
        <path d={line} fill="none" strokeWidth="1.75" vectorEffect="non-scaling-stroke" className={up ? 'stroke-up' : 'stroke-down'} />
      </svg>
      <p className="mt-1 text-[11px] text-mute">Reference price from Coinbase Exchange, not an Arc pool price.</p>
    </figure>
  )
}

// ---------- the agent demo (real parser, real chat rules) ----------

const TOKENS = [
  { symbol: 'ETH', name: 'Ether' },
  { symbol: 'BTC', name: 'Bitcoin' },
]
const SAMPLES = ['Buy $100 worth of ETH when the price drops 5%', 'DCA $500 into ETH over the next 7 days', 'Create an OCO order for ETH']

type Reading = { kind: 'proposal'; command: string; label: string; fields: [string, string][]; note?: string } | { kind: 'ask'; text: string } | { kind: 'error'; text: string }

function read(text: string, ethPrice: number | null): Reading | null {
  const t = text.trim()
  if (!t) return null
  const strict = parseCommand(t)
  let command = t
  let note: string | undefined
  let parsed = strict
  if (!strict.ok) {
    const ctx: ChatContext = { tokens: TOKENS, quote: 'USDC', connected: false, holdings: [], prices: ethPrice ? { ETH: ethPrice } : {}, freeQuote: 0, protectedSymbols: [], activeDca: 0 }
    const chat = interpretChat(t, ctx)
    if (chat.kind === 'reply') return { kind: 'ask', text: chat.text }
    if (chat.kind !== 'command') return { kind: 'error', text: `${strict.error}${strict.example ? ` Example: ${strict.example}` : ''}` }
    command = chat.command
    note = chat.note.replace(/^I read that as: [^.]*\.?\s*/, '') || undefined
    parsed = parseCommand(chat.command)
  }
  if (!parsed.ok) return { kind: 'error', text: parsed.error }
  const view = describeIntent(parsed.intent, TOKENS.map((x) => x.symbol))
  if (!view) return { kind: 'error', text: 'That is a lookup, not a trade. Try describing an order.' }
  return { kind: 'proposal', command, label: view.label, fields: view.fields, note }
}

function AgentDemo({ onOpenAgent, bare }: { onOpenAgent: (text: string) => void; bare?: boolean }) {
  const eth = useEthPrice()
  const price = eth.data?.last ?? null
  const [text, setText] = useState(SAMPLES[0])
  const reading = useMemo(() => read(text, price), [text, price])
  return (
    <div className={clsx(!bare && 'rounded-2xl border border-line bg-panel shadow-hard-lg')}>
      <div className="p-4 sm:p-5">
        <label htmlFor={`demo-prompt-${bare ? 'hero' : 'section'}`} className="mb-2 block text-sm font-semibold">
          Tell the agent what you want
        </label>
        <textarea
          id={`demo-prompt-${bare ? 'hero' : 'section'}`}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full resize-none rounded-xl border border-control bg-raised px-3.5 py-3 text-[15px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--ring))]"
        />
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Examples">
          {SAMPLES.map((s) => (
            <li key={s}>
              <button type="button" onClick={() => setText(s)} className={clsx('min-h-[36px] rounded-lg border px-2.5 text-xs', text === s ? 'border-accent text-ink' : 'border-line text-mute hover:text-ink')}>
                {s.length > 28 ? `${s.slice(0, 26)}...` : s}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-line p-4 sm:p-5" aria-live="polite">
        {reading === null && <p className="text-sm text-mute">Type a strategy above.</p>}
        {reading?.kind === 'ask' && <p className="text-sm">{reading.text}</p>}
        {reading?.kind === 'error' && <p className="text-sm text-mute">{reading.text}</p>}
        {reading?.kind === 'proposal' && (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base">How the agent reads it: {reading.label}</h3>
              <span className="rounded-md bg-raised px-1.5 py-0.5 text-[11px] text-mute">Proposal, nothing sent</span>
            </div>
            <dl className="flex flex-wrap gap-px overflow-hidden rounded-lg border border-line bg-line">
              {reading.fields.map(([k, v]) => (
                <div key={k} className="min-w-0 grow basis-[7rem] bg-raised px-3 py-2">
                  <dt className="text-[11px] text-mute">{k}</dt>
                  <dd className="num mt-0.5 break-words text-[13px] font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            {reading.note && <p className="mt-2 text-xs text-mute">{reading.note}</p>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="num min-w-0 break-words text-xs text-mute">{reading.command}</p>
              <button type="button" onClick={() => onOpenAgent(text)} className="press min-h-[40px] rounded-lg bg-accent px-3.5 text-sm font-semibold text-accent-ink hover:brightness-110">
                Review it in the Agent
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Four plain-words prompts read by the real rules, at the live ETH price, so the page shows breadth and not one demo twice. */
function StrategyExamples({ onOpenAgent }: { onOpenAgent: (t: string) => void }) {
  const eth = useEthPrice()
  const price = eth.data?.last ?? null
  const rows = useMemo(() => {
    const round = (n: number) => String(Math.round(n))
    const prompts = [
      'Buy $100 worth of ETH when the price drops 5%',
      'DCA $500 into ETH over the next 7 days',
      ...(price ? [`Sell all my ETH if it falls to ${round(price * 0.9)} or rises to ${round(price * 1.2)}`] : []),
      'Put a 5% trailing stop on all my ETH',
    ]
    return prompts.map((p) => ({ prompt: p, reading: read(p, price) }))
  }, [price])
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line bg-panel">
      {rows.map(({ prompt, reading }) => (
        <li key={prompt} className="p-4 sm:p-5">
          <p className="text-[15px] font-medium">{prompt}</p>
          {reading?.kind === 'proposal' ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="min-w-0 text-sm text-mute">
                <span className="font-semibold text-ink">{reading.label}</span> <span className="num break-words">{reading.command}</span>
              </p>
              <button type="button" onClick={() => onOpenAgent(prompt)} className="min-h-[36px] rounded-lg border border-control px-3 text-xs font-semibold hover:bg-raised">
                Open in the Agent
              </button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-mute">{reading?.kind === 'ask' ? reading.text : 'The agent would ask for the missing detail.'}</p>
          )}
        </li>
      ))}
    </ul>
  )
}

// ---------- 1. Is this for me? ----------

const AUDIENCE: { who: string; text: string }[] = [
  { who: 'Active crypto traders', text: 'You place several orders a day and want them set once and watched for you.' },
  { who: 'DeFi users', text: 'You want to stay in your own wallet and still use stops and recurring buys.' },
  { who: 'Advanced order users', text: 'You need stop-limit, trailing stop and OCO, not just buy and sell.' },
  { who: 'AI-agent traders', text: 'You would rather describe a strategy than fill in six fields.' },
]

function Hero({ onTrade, onAgent, onOpenAgent }: { onTrade: () => void; onAgent: () => void; onOpenAgent: (t: string) => void }) {
  return (
    <section className={clsx(wrap, 'pt-6 sm:pt-12 lg:pt-16')}>
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14">
        <div className="min-w-0">
          <h1 className="min-w-0 break-words text-[2.5rem] font-extrabold leading-[1.04] sm:text-6xl lg:text-[4rem]">Trade on Arc with an AI agent.</h1>
          <p className="mt-5 max-w-md text-lg text-mute">Describe a strategy, review it, approve it in your wallet.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={onTrade} className="press min-h-[52px] rounded-xl bg-accent px-6 text-base font-semibold text-accent-ink hover:brightness-110">
              Open the terminal
            </button>
            <button onClick={onAgent} className="press min-h-[52px] rounded-xl border border-control bg-panel px-6 text-base font-semibold hover:bg-raised">
              Try the Agent
            </button>
          </div>
        </div>
        <div className="min-w-0">
          <div className="rounded-2xl border border-line bg-panel shadow-hard-lg">
            <AgentDemo bare onOpenAgent={onOpenAgent} />
            <div className="border-t border-line p-4 sm:p-5">
              <PriceLine product="ETH-USD" label="ETH / USD" />
            </div>
          </div>
        </div>
      </div>

      <ul className="mt-16 grid gap-x-8 gap-y-6 border-t border-line pt-8 sm:grid-cols-2 lg:mt-24 lg:grid-cols-4">
        {AUDIENCE.map((a) => (
          <li key={a.who}>
            <h2 className="text-base font-semibold tracking-normal">{a.who}</h2>
            <p className="mt-1.5 text-sm text-mute">{a.text}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------- 2. Can I trust you? ----------

function Trust() {
  const testnet = NETWORKS['arc-testnet']
  const mainnet = NETWORKS.arc
  const tokens = useTokenList(mainnet).tokens
  const rows: { k: string; v: ReactNode }[] = [
    {
      k: 'Order contract, Arc Testnet',
      v: testnet.ordersAddress ? (
        <a className="num inline-flex items-center gap-1 underline underline-offset-2" href={buildAddressExplorerUrl(testnet.chainId, testnet.ordersAddress)} target="_blank" rel="noopener noreferrer">
          {shortAddr(testnet.ordersAddress)} <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      ) : (
        'Not configured'
      ),
    },
    {
      k: 'Order contract, Arc mainnet',
      v: mainnet.ordersAddress ? (
        <a className="num inline-flex items-center gap-1 underline underline-offset-2" href={buildAddressExplorerUrl(mainnet.chainId, mainnet.ordersAddress)} target="_blank" rel="noopener noreferrer">
          {shortAddr(mainnet.ordersAddress)} <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      ) : (
        'Not deployed yet'
      ),
    },
    { k: 'Networks', v: `Arc (${mainnet.chainId}) and Arc Testnet (${testnet.chainId})` },
    ...(tokens.length > 0 ? [{ k: 'Tokens you can swap on Arc', v: `${tokens.length}, from the aggregator's list` }] : []),
    { k: 'Gas token', v: 'USDC' },
  ]
  return (
    <section className="border-t border-line py-20 sm:py-28">
      <div className={wrap}>
        <Reveal>
          <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
            <div>
              <h2 className="min-w-0 break-words text-4xl leading-[1.08] sm:text-5xl">Your funds stay yours. Everything is checkable.</h2>
              <ul className="mt-8 space-y-4 text-base">
                {[
                  'Tactora never holds your keys. Your wallet signs every transaction, including the ones the Agent proposes.',
                  'Orders are escrowed in a public contract. You can cancel and take your funds back at any time.',
                  'The code is open, and the order contract passed a live test run on Arc Testnet on 26 November 2026.',
                ].map((t) => (
                  <li key={t} className="flex gap-3">
                    <Check className="mt-1 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm text-mute">Not yet done: an independent audit. The contract has 191 automated tests and the test run above, which is not the same thing. Size your risk accordingly.</p>
              <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1 text-sm font-semibold">
                <a className="inline-flex min-h-[44px] items-center gap-1.5 underline underline-offset-4" href={`${BRAND.links.docs}/test-reports/ui-walkthrough-2026-11-26.md`} target="_blank" rel="noopener noreferrer">
                  Read the test report <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
                <a className="inline-flex min-h-[44px] items-center gap-1.5 underline underline-offset-4" href={BRAND.links.github} target="_blank" rel="noopener noreferrer">
                  Read the code <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            </div>
            <dl className="divide-y divide-line self-start rounded-2xl border border-line bg-panel">
              {rows.map((r) => (
                <div key={r.k} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-4 text-sm">
                  <dt className="text-mute">{r.k}</dt>
                  <dd className="min-w-0 break-words text-right font-semibold">{r.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ---------- 3. Do you understand my problem? ----------

const PROBLEMS: { before: string; after: string }[] = [
  { before: 'A different tool for swaps, orders, DCA and tracking.', after: 'One terminal and one wallet session for all four.' },
  { before: 'Six fields to fill in for every conditional order.', after: 'Say what you want. The agent fills the fields and you can edit them.' },
  { before: 'Watching the chart so a stop does not get missed.', after: 'Orders sit in escrow and a keeper fills them when your price hits. Close the tab.' },
  { before: 'Strategies that live in your head or a notes app.', after: 'Stop-loss, take-profit, OCO, trailing stop and DCA run on rules you set.' },
  { before: 'Not knowing the exact outcome until after you sign.', after: 'Every proposal lists amounts, fees and the minimum you receive first.' },
]

function Problems() {
  return (
    <section className="border-t border-line py-20 sm:py-28">
      <div className={wrap}>
        <Reveal>
          <SectionHead title="The work around a trade is the hard part." />
          <div className="grid gap-x-12 border-t border-line lg:grid-cols-2">
            <p className="hidden pt-4 text-sm font-semibold text-mute lg:block">Today</p>
            <p className="hidden pt-4 text-sm font-semibold lg:block">With Tactora</p>
            {PROBLEMS.map((p) => (
              <div key={p.before} className="contents">
                <p className="border-b border-line pt-5 text-mute lg:border-b lg:py-6">{p.before}</p>
                <p className="border-b border-line pb-6 pt-2 font-medium lg:py-6">{p.after}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ---------- 4. What do I get? ----------

const ORDER_TYPES: { name: string; text: string }[] = [
  { name: 'Market', text: 'Swap now at the best quoted route, with the minimum output shown first.' },
  { name: 'Limit', text: 'Buy or sell when the price reaches your level.' },
  { name: 'Stop-loss', text: 'Sell if the price falls to a level you choose.' },
  { name: 'Take-profit', text: 'Sell when the price rises to your target.' },
  { name: 'Stop-limit', text: 'A stop that becomes a limit order, so you set the worst price.' },
  { name: 'Trailing stop', text: 'A stop that follows the price up by a distance you set.' },
  { name: 'OCO', text: 'A stop-loss and a take-profit in one escrow. One runs, the other cannot.' },
  { name: 'DCA', text: 'Recurring buys, hourly to monthly, with an optional price cap.' },
]

const DASHBOARD = ['Portfolio value and balances', 'Open orders and escrowed funds', 'DCA plans, with pause and resume', 'Trade history and fills', 'Realized and unrealized profit and loss']

function Features({ onOpenAgent, onTrade, onDashboard }: { onOpenAgent: (t: string) => void; onTrade: () => void; onDashboard: () => void }) {
  return (
    <section className="border-t border-line py-20 sm:py-28">
      <div className={wrap}>
        <Reveal>
          <SectionHead title="Everything you need to place, manage and review trades." />

          <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
            <div>
              <h3 className="text-2xl">AI agent trading</h3>
              <p className="mt-3 max-w-md text-mute">Write a strategy in your own words. The agent turns it into one exact command and shows it back, so you can see what will run before it does.</p>
              <ul className="mt-6 space-y-2 text-sm">
                {['Natural-language prompts', 'The agent shows how it read your request', 'You edit the proposal before anything runs', 'You approve every transaction in your wallet'].map((t) => (
                  <li key={t} className="flex gap-3">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0">
              <StrategyExamples onOpenAgent={onOpenAgent} />
            </div>
          </div>

          <div className="mt-20 grid gap-12 border-t border-line pt-16 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16">
            <div className="order-2 lg:order-1">
              <dl className="grid gap-x-8 sm:grid-cols-2">
                {ORDER_TYPES.map((o) => (
                  <div key={o.name} className="border-b border-line py-4">
                    <dt className="text-sm font-semibold">{o.name}</dt>
                    <dd className="mt-1 text-sm text-mute">{o.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="order-1 min-w-0 lg:order-2">
              <h3 className="text-2xl">Advanced trading</h3>
              <p className="mt-3 max-w-md text-mute">A live chart, a buy and sell form and every order type in one screen. Orders are escrowed in the contract, not held by an exchange.</p>
              <div className="mt-6 rounded-2xl border border-line bg-panel p-4">
                <PriceLine product="BTC-USD" label="BTC / USD" />
              </div>
              <button onClick={onTrade} className="press mt-5 min-h-[44px] rounded-lg border border-control px-4 text-sm font-semibold hover:bg-raised">
                Open the trading screen
              </button>
            </div>
          </div>

          <div className="mt-20 grid gap-8 border-t border-line pt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
            <div>
              <h3 className="text-2xl">Trading dashboard</h3>
              <p className="mt-3 max-w-md text-mute">Everything you hold, everything you have waiting, and what it did.</p>
              <button onClick={onDashboard} className="press mt-5 min-h-[44px] rounded-lg border border-control px-4 text-sm font-semibold hover:bg-raised">
                Open the dashboard
              </button>
            </div>
            <ul className="divide-y divide-line border-y border-line">
              {DASHBOARD.map((d) => (
                <li key={d} className="py-3.5 text-sm">
                  {d}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ---------- 5. How does it work? ----------

const STEPS: { title: string; text: string }[] = [
  { title: 'Connect your wallet', text: 'Use a browser wallet, or a passkey wallet with your fingerprint where enabled.' },
  { title: 'Pick a trading pair', text: 'Choose a token, see its chart and price, and switch between Arc and Arc Testnet.' },
  { title: 'Set the order, or describe it', text: 'Fill in the order form, or write the strategy to the Agent.' },
  { title: 'Review the proposal', text: 'Check amounts, fees and the minimum you receive. Edit anything, or cancel.' },
  { title: 'Approve and sign', text: 'Your wallet asks you to confirm. Nothing runs before you do.' },
  { title: 'Watch it in your dashboard', text: 'Orders wait in escrow and a keeper fills them at your price. Cancel any time for a refund.' },
]

function How() {
  return (
    <section className="border-t border-line py-20 sm:py-28">
      <div className={wrap}>
        <Reveal>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-20">
            <div>
              <h2 className="min-w-0 break-words text-4xl leading-[1.08] sm:text-5xl lg:sticky lg:top-28">From wallet to filled order in six steps.</h2>
            </div>
            <ol className="relative">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative flex gap-5 pb-10 last:pb-0">
                  {i < STEPS.length - 1 && <span className="absolute left-[15px] top-9 h-[calc(100%-2.25rem)] w-px bg-line" aria-hidden="true" />}
                  <span className="num grid h-8 w-8 shrink-0 place-items-center rounded-full border border-control bg-panel text-sm font-semibold">{i + 1}</span>
                  <div className="min-w-0 pt-0.5">
                    <h3 className="text-xl">{s.title}</h3>
                    <p className="mt-1.5 text-mute">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ---------- 6. How much? ----------

function Price({ onTrade }: { onTrade: () => void }) {
  const health = useBackendHealth()
  const fee = health.data?.platformFee
  const swapFee = health.isLoading ? 'Checking' : fee ? `${(fee.bps / 100).toFixed(2)}% of the amount sold` : 'None right now'
  const rows: { item: string; cost: string; note: string }[] = [
    { item: 'Using Tactora', cost: 'Free', note: 'No subscription and no deposit with us.' },
    { item: 'Market swaps', cost: swapFee, note: 'Set by the operator, capped at 1%, and shown in the proposal before you sign.' },
    { item: 'Orders and DCA', cost: 'Up to 0.10% of the output', note: 'A keeper fee paid to whoever fills the order. The owner can only lower it.' },
    { item: 'Network fee', cost: 'Paid in USDC', note: 'USDC is the gas token on Arc. A passkey wallet can have it sponsored on testnet.' },
    { item: 'Price and slippage', cost: 'In the quote', note: 'The route price is in the minimum you receive. You set the slippage you accept.' },
  ]
  return (
    <section className="border-t border-line py-20 sm:py-28">
      <div className={wrap}>
        <Reveal>
          <SectionHead title="What it costs, in full.">Nothing up front. You pay small fees when something fills. Rates here are read live where the server knows them.</SectionHead>
          <div className="overflow-hidden rounded-2xl border border-line bg-panel">
            <table className="w-full text-left text-sm">
              <thead className="sr-only">
                <tr>
                  <th>Item</th>
                  <th>Cost</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.item} className={clsx('block px-5 py-4 md:table-row md:p-0', i > 0 && 'border-t border-line')}>
                    <th scope="row" className="block font-semibold md:table-cell md:w-1/4 md:px-5 md:py-4">
                      {r.item}
                    </th>
                    <td className="num block font-semibold md:table-cell md:w-1/4 md:px-5 md:py-4">{r.cost}</td>
                    <td className="block text-mute md:table-cell md:px-5 md:py-4">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button onClick={onTrade} className="press min-h-[48px] rounded-xl bg-accent px-5 text-sm font-semibold text-accent-ink hover:brightness-110">
              Open the terminal
            </button>
            <p className="text-sm text-mute">Start on Arc Testnet, where tokens have no value.</p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ---------- 7. What if? ----------

const FAQ: { q: string; a: string }[] = [
  { q: 'Do I keep control of my wallet?', a: 'Yes. Tactora never holds your keys. Every transaction is signed in your own wallet, and orders are escrowed in a public contract, not with us.' },
  { q: 'Does the AI Agent trade on its own?', a: 'No. It turns your words into one proposal and shows it. Nothing is sent until you approve, and your wallet still asks you to sign. Inside limits you set, a command can run right after the readback if you allow that, and anything bigger still waits for you.' },
  { q: 'Can I review a strategy before it runs?', a: 'Yes. Every proposal lists the order type, amounts, prices, fees and the minimum you receive. You can edit it, send it back to the box, or cancel.' },
  { q: 'What happens if a transaction fails?', a: 'Nothing is lost. The wallet shows the error, the Agent reports "Nothing was completed", and you can edit the command and try again. Cancelling an order or a DCA plan works at any time.' },
  { q: 'Are my funds held by Tactora?', a: 'No. Funds stay in your wallet until you place an order. Then they sit in the order contract, which only you can cancel, and fills pay out to your wallet.' },
  { q: 'Which network does it use?', a: 'Arc, and Arc Testnet for trying everything with test tokens. Pick the network in the header.' },
  { q: 'How do stop-loss, take-profit, OCO and DCA work?', a: 'A stop-loss sells if the price falls to your level, and a take-profit sells if it rises. OCO pairs them so one cancels the other. DCA buys a fixed amount on a schedule. A keeper submits the fill when the price condition is met.' },
  { q: 'What if the price moves past my stop?', a: 'A triggered order is not guaranteed to fill at that price. The contract refuses any fill below its own floor, so in a fast market an order can stay open. Your funds stay in escrow until it fills, you cancel or it expires.' },
  { q: 'Is the contract audited?', a: 'Not yet. It has automated tests and a live testnet run, but no independent audit. Do not put in more than you can afford to lose.' },
]

function Faq() {
  return (
    <section className="border-t border-line py-20 sm:py-28">
      <div className={wrap}>
        <Reveal>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-20">
            <h2 className="min-w-0 break-words text-4xl leading-[1.08] sm:text-5xl">Questions before you start.</h2>
            <div className="divide-y divide-line border-y border-line">
              {FAQ.map((f) => (
                <details key={f.q} className="group">
                  <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-semibold hover:text-brand">
                    {f.q}
                    <span className="num text-xl text-mute group-open:hidden" aria-hidden="true">
                      +
                    </span>
                    <span className="num hidden text-xl text-mute group-open:inline" aria-hidden="true">
                      -
                    </span>
                  </summary>
                  <p className="pb-5 pr-8 text-mute">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ---------- closing ----------

function Closing({ onTrade, onAgent }: { onTrade: () => void; onAgent: () => void }) {
  return (
    <section className="border-t border-line py-20 sm:py-28">
      <div className={wrap}>
        <Reveal>
          <div className="rounded-3xl border border-line bg-panel px-6 py-14 text-center sm:px-12 sm:py-20">
            <h2 className="mx-auto min-w-0 max-w-2xl break-words text-4xl leading-[1.08] sm:text-5xl">Try a strategy on Arc Testnet first.</h2>
            <p className="mx-auto mt-4 max-w-md text-mute">Take test tokens, set an order or ask the Agent, and watch it fill.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button onClick={onTrade} className="press min-h-[52px] rounded-xl bg-accent px-6 text-base font-semibold text-accent-ink hover:brightness-110">
                Open the terminal
              </button>
              <button onClick={onAgent} className="press min-h-[52px] rounded-xl border border-control bg-panel px-6 text-base font-semibold hover:bg-raised">
                Try the Agent
              </button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

export function Landing() {
  const { setPage } = useSettings()
  const trade = () => setPage('trade')
  const agent = () => setPage('agent')
  const dashboard = () => setPage('dashboard')
  const openAgent = (text: string) => {
    setAgentPrefill(text)
    agent()
  }
  return (
    <div className="w-full pb-8">
      <Hero onTrade={trade} onAgent={agent} onOpenAgent={openAgent} />
      <Trust />
      <Problems />
      <Features onOpenAgent={openAgent} onTrade={trade} onDashboard={dashboard} />
      <How />
      <Price onTrade={trade} />
      <Faq />
      <Closing onTrade={trade} onAgent={agent} />
    </div>
  )
}
