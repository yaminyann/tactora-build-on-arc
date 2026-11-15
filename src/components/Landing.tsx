import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { clsx } from 'clsx'
import { BRAND } from '@/brand'
import { fetchTokenList } from '@/trading/tokens'
import { useSettings } from '@/trading/settings'
import { setAgentPrefill } from '@/trading/agent/prefill'
import { Reveal } from './motion'
import { Skeleton } from './ui'

// ---------- shared components ----------

function Heading({ kicker, children }: { kicker: string; children: ReactNode }) {
  return (
    <div className="mb-6 max-w-2xl">
      <p className="mb-2 inline-block border border-line bg-accent px-2 py-0.5 font-mono text-xs font-semibold text-accent-ink">
        {kicker}
      </p>
      <h2 className="text-2xl leading-tight sm:text-4xl">{children}</h2>
    </div>
  )
}

function Cta({ children, onClick, variant = 'primary' }: { children: ReactNode; onClick: () => void; variant?: 'primary' | 'ghost' }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'press min-h-[48px] border border-line px-5 text-sm font-bold shadow-hard sm:min-h-[52px] sm:px-6 sm:text-base',
        variant === 'primary' ? 'bg-accent text-accent-ink' : 'bg-panel hover:bg-raised text-ink',
      )}
    >
      {children}
    </button>
  )
}

// ---------- scripted agent session demo ----------

interface Script {
  id: string
  feature: string
  command: string
  lines: [string, string][]
  result: string
}

const SCRIPTS: Script[] = [
  {
    id: 'swap',
    feature: 'DEX swap',
    command: 'buy 10 USDC of tBTC',
    lines: [
      ['Action', 'Market buy tBTC'],
      ['You spend', '10 USDC'],
      ['Route', 'Best of 0x / KyberSwap'],
      ['Max slippage', '0.50%'],
    ],
    result: 'Swap routed via aggregator. Guaranteed minimum output enforced on-chain.',
  },
  {
    id: 'limit',
    feature: 'Limit order',
    command: 'limit buy tBTC 25 USDC at 70000',
    lines: [
      ['Action', 'Limit buy tBTC'],
      ['Escrowed now', '25 USDC'],
      ['Buys at or below', '70,000 USDC'],
      ['Expires', '7 days'],
    ],
    result: 'Order created in contract escrow. Filled when oracle reaches price.',
  },
  {
    id: 'sl',
    feature: 'Stop-loss',
    command: 'stop loss 0.5 tBTC at 80000',
    lines: [
      ['Action', 'Stop-loss sell tBTC'],
      ['Escrowed now', '0.5 tBTC'],
      ['Sells when price falls to', '80,000 USDC'],
      ['Max slippage', '0.50%'],
    ],
    result: 'Order created. Keepers monitor oracle and execute automatically.',
  },
  {
    id: 'dca',
    feature: 'DCA plan',
    command: 'dca 5 USDC into tBTC daily for 30 days',
    lines: [
      ['Action', 'Recurring buy of tBTC'],
      ['Per buy', '5 USDC'],
      ['Frequency', 'Daily (30 buys)'],
      ['Budget escrowed', '150 USDC'],
    ],
    result: 'Plan created. Cancel or pause anytime to reclaim unspent escrow.',
  },
]

type Step = 'typing' | 'readback' | 'yes' | 'done'

function AgentDemo({ index, onIndex }: { index: number; onIndex: (i: number) => void }) {
  const { animate } = useSettings()
  const script = SCRIPTS[index]
  const [typed, setTyped] = useState(animate ? 0 : script.command.length)
  const [step, setStep] = useState<Step>(animate ? 'typing' : 'done')
  const [paused, setPaused] = useState(false)
  const running = animate && !paused
  const advance = useRef(onIndex)
  useEffect(() => {
    advance.current = onIndex
  })

  useEffect(() => {
    if (!animate) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))
    const typeEnd = 400 + script.command.length * 40
    for (let i = 1; i <= script.command.length; i++) at(400 + i * 40, () => setTyped(i))
    at(typeEnd + 350, () => setStep('readback'))
    at(typeEnd + 2100, () => setStep('yes'))
    at(typeEnd + 2800, () => setStep('done'))
    return () => timers.forEach(clearTimeout)
  }, [animate, script])

  useEffect(() => {
    if (step !== 'done' || !running) return
    const t = setTimeout(() => advance.current((index + 1) % SCRIPTS.length), 3200)
    return () => clearTimeout(t)
  }, [step, running, index])

  return (
    <div className="border border-line bg-panel shadow-hard-lg" role="group" aria-label="Agent session demo">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-accent px-3 py-2 text-accent-ink">
        <span className="font-display text-sm sm:text-base">Agent Station Demo</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold">Live Preview</span>
          {animate && (
            <button
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
              className="min-h-[28px] border border-line bg-panel px-2 font-mono text-[11px] font-semibold text-ink hover:bg-raised"
            >
              {paused ? 'Play' : 'Pause'}
            </button>
          )}
        </div>
      </div>
      <div className="min-h-[340px] space-y-3 p-3 sm:p-4" aria-live="polite">
        <div className="flex justify-end">
          <div className="max-w-[90%] border border-line bg-ink px-3 py-2 font-mono text-xs sm:text-sm text-canvas">
            {script.command.slice(0, typed)}
            {step === 'typing' && running && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-canvas" />}
          </div>
        </div>
        <AnimatePresence initial={false}>
          {step !== 'typing' && (
            <motion.div
              key={`${script.id}-card`}
              initial={animate ? { opacity: 0, y: 6 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16 }}
              className="max-w-[96%] border border-line bg-raised p-3"
            >
              <p className="text-xs sm:text-sm font-bold">Is this exactly what you want?</p>
              <div className="mt-2 border border-line bg-panel px-3">
                {script.lines.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 border-b border-line/40 py-1.5 text-xs last:border-b-0">
                    <span className="text-mute">{k}</span>
                    <span className="num text-right font-semibold">{v}</span>
                  </div>
                ))}
              </div>
              {step === 'readback' && (
                <div className="mt-2.5 flex gap-2 text-xs font-bold">
                  <span className="flex-1 border border-line bg-accent py-1.5 text-center text-accent-ink shadow-hard-sm">Yes, run it</span>
                  <span className="flex-1 border border-line bg-panel py-1.5 text-center">Cancel</span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {(step === 'yes' || step === 'done') && (
          <div className="flex justify-end">
            <div className="border border-line bg-ink px-3 py-1.5 font-mono text-xs sm:text-sm text-canvas">yes</div>
          </div>
        )}
        {step === 'done' && (
          <p className="max-w-[96%] border border-line bg-up px-3 py-2 text-xs sm:text-sm font-semibold text-canvas">
            {script.result}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[11px] text-mute">
        <span>Illustrative simulation</span>
        <div className="flex gap-1.5">
          {SCRIPTS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => onIndex(i)}
              className={clsx(
                'px-1.5 py-0.5 font-mono text-[10px] font-bold border border-line',
                index === i ? 'bg-accent text-accent-ink' : 'bg-panel text-mute hover:text-ink',
              )}
            >
              {s.feature}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------- 1. hero section ----------

function Hero({ onTrade, onAgent }: { onTrade: () => void; onAgent: () => void }) {
  const [index, setIndex] = useState(0)
  const tokens = useQuery({ queryKey: ['landing-tokens'], queryFn: () => fetchTokenList(5042), staleTime: 10 * 60_000, retry: 1 })
  const count = tokens.data ? Math.max(0, tokens.data.length - 1) : null

  const facts: { value: string; label: string }[] = [
    { value: count === null ? (tokens.isError ? '60+' : '...') : `${count}+`, label: 'Aggregator-routable tokens' },
    { value: '6 + DCA', label: 'Escrowed order types' },
    { value: '0.10%', label: 'Max keeper fee (lower-only)' },
    { value: 'Self-custody', label: 'Cancel & withdraw anytime' },
  ]

  return (
    <section className="pt-2 sm:pt-6">
      <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 border border-line bg-panel px-2.5 py-1 text-xs font-semibold">
            <span className="h-2 w-2 bg-up" aria-hidden="true" />
            <span>Built for Arc Network</span>
          </div>
          <h1 className="text-3xl leading-[1.05] sm:text-5xl lg:text-[3.6rem]">
            Swaps, stops and DCA on Arc.
          </h1>
          <p className="mt-4 max-w-lg text-sm text-mute sm:text-base leading-relaxed">
            Non-custodial trading terminal on Arc. Route market swaps through 0x and KyberSwap, escrow automated orders that run with your browser closed, or command the terminal through the Agent Station.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Cta onClick={onTrade}>Open terminal</Cta>
            <Cta onClick={onAgent} variant="ghost">
              Try the agent
            </Cta>
          </div>
        </div>

        <div>
          <AgentDemo key={index} index={index} onIndex={setIndex} />
        </div>
      </div>

      <dl className="mt-10 grid grid-cols-2 border border-line bg-panel lg:grid-cols-4 shadow-hard-sm">
        {facts.map((f, i) => (
          <div
            key={f.label}
            className={clsx(
              'p-4 sm:p-5',
              i > 0 && 'border-t border-line sm:border-t-0',
              i % 2 === 1 && 'border-l border-line',
              i >= 2 && 'sm:border-t lg:border-t-0',
              i === 2 && 'sm:border-l-0 lg:border-l border-line',
            )}
          >
            <dd className="num font-display text-2xl leading-none sm:text-3xl">{f.value}</dd>
            <dt className="mt-1.5 text-xs text-mute font-medium">{f.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  )
}

// ---------- 2. core features ----------

const CORE_FEATURES = [
  {
    num: '01',
    title: 'DEX Aggregation',
    summary: 'Parallel routing through 0x and KyberSwap v2. Quotes are ranked by guaranteed net output minus gas, with instant on-chain simulation.',
  },
  {
    num: '02',
    title: 'Conditional Orders',
    summary: 'Limit, Stop-Loss, Take-Profit, Stop-Limit, Trailing Stop, and OCO. Funds stay escrowed in ArcTradeOrders until filled or cancelled.',
  },
  {
    num: '03',
    title: 'Recurring DCA',
    summary: 'Automate dollar-cost averaging into assets hourly, daily, weekly, or monthly. Includes maximum price caps to prevent buying local peaks.',
  },
  {
    num: '04',
    title: 'Agent Station',
    summary: 'Deterministic natural language command execution. Fixed grammar, balance-aware plan readbacks, and strict permission limits.',
  },
]

function CoreFeatures({ onSelectAction }: { onSelectAction: (cmd: string) => void }) {
  return (
    <section>
      <Heading kicker="Core Capabilities">Engineered for precise on-chain execution.</Heading>
      <div className="grid gap-4 sm:grid-cols-2">
        {CORE_FEATURES.map((feat) => (
          <Reveal key={feat.num}>
            <div className="flex h-full flex-col justify-between border border-line bg-panel p-5 shadow-hard-sm hover:bg-raised/40 transition">
              <div>
                <span className="num font-mono text-xs font-bold text-mute">{feat.num}</span>
                <h3 className="mt-2 text-xl font-bold">{feat.title}</h3>
                <p className="mt-2 text-xs sm:text-sm leading-relaxed text-mute">{feat.summary}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

// ---------- 3. security & non-custodial architecture ----------

function SecurityArchitecture() {
  return (
    <section>
      <Heading kicker="Architecture & Trust">Non-custodial by contract design.</Heading>
      <Reveal>
        <div className="grid border border-line bg-panel shadow-hard md:grid-cols-2">
          <div className="p-5 sm:p-6">
            <div className="mb-2 inline-block border border-line bg-ink px-2 py-0.5 font-mono text-xs font-bold text-canvas">
              Your Wallet & Control
            </div>
            <h3 className="text-xl font-bold">You remain in control</h3>
            <ul className="mt-4 space-y-2.5 text-xs sm:text-sm text-ink/90">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 shrink-0 bg-ink" aria-hidden="true" />
                <span><strong>No platform custody:</strong> Market swaps execute directly through aggregator routers.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 shrink-0 bg-ink" aria-hidden="true" />
                <span><strong>Wallet signature required:</strong> Every order, approval, and swap requires your explicit confirmation.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 shrink-0 bg-ink" aria-hidden="true" />
                <span><strong>Cancel anytime:</strong> Orders and DCA plans can be cancelled for an immediate refund, even during contract pauses.</span>
              </li>
            </ul>
          </div>

          <div className="border-t border-line bg-raised/50 p-5 sm:p-6 md:border-l md:border-t-0">
            <div className="mb-2 inline-block border border-line bg-panel px-2 py-0.5 font-mono text-xs font-bold text-ink">
              Contract & Keepers
            </div>
            <h3 className="text-xl font-bold">On-chain enforcement</h3>
            <ul className="mt-4 space-y-2.5 text-xs sm:text-sm text-mute">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 shrink-0 border border-line bg-canvas" aria-hidden="true" />
                <span><strong>Chainlink oracle triggers:</strong> Execution price and slippage floors are validated against verified price feeds.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 shrink-0 border border-line bg-canvas" aria-hidden="true" />
                <span><strong>Permissionless keepers:</strong> Anyone can execute triggered orders. Keeper fees are capped at 0.10% and can only be lowered.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 shrink-0 border border-line bg-canvas" aria-hidden="true" />
                <span><strong>Timelocked admin:</strong> Admin changes require a timelock delay. The contract owner cannot touch user escrow.</span>
              </li>
            </ul>
          </div>
        </div>
      </Reveal>
    </section>
  )
}

// ---------- 4. curated faq ----------

const CURATED_FAQ = [
  {
    q: 'Do you hold my funds?',
    a: 'No. Swaps execute wallet-to-router in a single transaction. Conditional orders and DCA plans are held in the ArcTradeOrders contract escrow, which only releases funds upon verified trigger conditions or when you cancel.',
  },
  {
    q: 'Who executes my conditional orders?',
    a: 'Execution is open to any keeper bot. When oracle prices meet your trigger condition, a keeper submits the transaction and receives a protocol fee capped at 0.10%. The terminal runs a built-in keeper, and you can run your own.',
  },
  {
    q: 'Which tokens can I trade?',
    a: 'For market swaps, any token routable on Arc via 0x or KyberSwap. For conditional orders and DCA, the token must also have an active Chainlink price feed registered on the order contract.',
  },
  {
    q: 'Can I try it without real money?',
    a: 'Yes. Switch to Arc Testnet in the top navigation. You can claim test tokens from the faucet, adjust test oracle prices, and watch orders fill without risking real assets.',
  },
] as const

function CuratedFaq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section>
      <Heading kicker="FAQ">Frequently asked questions.</Heading>
      <div className="border border-line bg-panel shadow-hard-sm">
        {CURATED_FAQ.map((f, i) => (
          <div key={f.q} className={clsx(i > 0 && 'border-t border-line')}>
            <h3>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}
                className="flex min-h-[52px] w-full items-center justify-between gap-4 px-4 py-3 text-left font-sans text-sm sm:text-base font-bold hover:bg-raised"
              >
                <span>{f.q}</span>
                <span className="num text-lg" aria-hidden="true">
                  {open === i ? '−' : '+'}
                </span>
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {open === i && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.16 }}
                  className="overflow-hidden"
                >
                  <p className="px-4 pb-4 text-xs sm:text-sm text-mute leading-relaxed">{f.a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---------- 5. closing CTA ----------

function Closing({ onTrade }: { onTrade: () => void }) {
  return (
    <section>
      <Reveal>
        <div className="border border-line bg-ink p-6 text-canvas shadow-hard-lg sm:p-10">
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-display leading-tight">
            Try every order type on testnet first.
          </h2>
          <p className="mt-3 max-w-xl text-xs sm:text-sm text-canvas/80 leading-relaxed">
            Switch to Arc Testnet, claim test funds from the faucet, trigger orders with the test feed, and observe execution mechanics with zero financial risk.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={onTrade}
              className="press min-h-[48px] border border-canvas bg-accent px-6 text-sm font-bold text-accent-ink shadow-[3px_3px_0_0_rgb(var(--bg))]"
            >
              Open terminal
            </button>
            <a
              href={BRAND.links.docs}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[48px] items-center border border-canvas px-6 text-sm font-bold hover:bg-canvas hover:text-ink transition"
            >
              Documentation
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  )
}

// ---------- main landing page component ----------

export function Landing() {
  const { setPage } = useSettings()
  const tryCommand = useCallback(
    (command: string) => {
      setAgentPrefill(command)
      setPage('agent')
    },
    [setPage],
  )

  return (
    <div className="mx-auto w-full max-w-5xl space-y-16 px-4 sm:px-6 sm:space-y-20 pb-10">
      <Hero onTrade={() => setPage('trade')} onAgent={() => setPage('agent')} />
      <CoreFeatures onSelectAction={tryCommand} />
      <SecurityArchitecture />
      <CuratedFaq />
      <Closing onTrade={() => setPage('trade')} />
    </div>
  )
}
