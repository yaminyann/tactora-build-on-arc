import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { clsx } from 'clsx'
import { ArrowUpRight, Check, ChevronRight, Copy, Terminal as TerminalIcon, Zap, Shield, Cpu, RefreshCw } from 'lucide-react'
import { BRAND } from '@/brand'
import { fetchTokenList } from '@/trading/tokens'
import { useSettings } from '@/trading/settings'
import { setAgentPrefill } from '@/trading/agent/prefill'
import { Reveal } from './motion'
import { Skeleton } from './ui'

// ---------- shared UI helpers ----------

function SectionKicker({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 inline-flex items-center gap-1.5 border border-line bg-accent px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-accent-ink">
      {children}
    </div>
  )
}

function SectionHeader({ kicker, title, desc }: { kicker: string; title: string; desc?: string }) {
  return (
    <div className="mb-8 max-w-3xl">
      <SectionKicker>{kicker}</SectionKicker>
      <h2 className="text-2xl font-display uppercase tracking-tight sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      {desc && <p className="mt-3 text-xs sm:text-sm text-mute leading-relaxed">{desc}</p>}
    </div>
  )
}

// ---------- 1. hero section (Hyperliquid style) ----------

interface PromptPreset {
  label: string
  command: string
  intent: string
  lines: [string, string][]
  outcome: string
}

const PROMPT_PRESETS: PromptPreset[] = [
  {
    label: 'Market Swap',
    command: 'buy 250 USDC of cirBTC',
    intent: 'Market Buy · Aggregator Route',
    lines: [
      ['Pair', 'cirBTC / USDC'],
      ['Spend', '250.00 USDC'],
      ['Route', '0x & KyberSwap v2 (Best Net)'],
      ['Slippage floor', '0.50% max'],
    ],
    outcome: 'Aggregator quote verified. Guaranteed minimum received output enforced on-chain.',
  },
  {
    label: 'Limit Order',
    command: 'limit buy cirBTC 50 USDC at 72000',
    intent: 'Conditional Limit · Escrowed',
    lines: [
      ['Type', 'Limit Buy'],
      ['Target price', '72,000 USDC'],
      ['Escrow amount', '50.00 USDC'],
      ['Validity', '7 Days (Cancel anytime)'],
    ],
    outcome: 'Escrowed in ArcTradeOrders. Permissionless keeper executes when oracle crosses 72,000.',
  },
  {
    label: 'Stop Loss',
    command: 'stop loss 0.25 cirBTC at 79000',
    intent: 'Stop-Loss · Chainlink Trigger',
    lines: [
      ['Type', 'Stop-Loss Sell'],
      ['Trigger price', '79,000 USDC'],
      ['Asset locked', '0.25 cirBTC'],
      ['Keeper fee', '0.10% of output (capped)'],
    ],
    outcome: 'Automated stop-loss active. Runs automatically even when your browser is closed.',
  },
  {
    label: 'DCA Accumulation',
    command: 'dca 10 USDC into WETH daily for 30 days',
    intent: 'Recurring DCA · Automated',
    lines: [
      ['Action', 'Recurring Buy (WETH)'],
      ['Interval', 'Daily (30 executions)'],
      ['Budget escrow', '300.00 USDC'],
      ['Price cap', 'Optional ceiling protection'],
    ],
    outcome: 'DCA contract plan active. Keeper executes daily ticks. Unspent balance refundable anytime.',
  },
]

function Hero({ onTrade, onAgent }: { onTrade: () => void; onAgent: () => void }) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [customText, setCustomText] = useState('')
  const [activeStep, setActiveStep] = useState<'prompt' | 'plan' | 'done'>('plan')
  const tokens = useQuery({ queryKey: ['landing-tokens'], queryFn: () => fetchTokenList(5042), staleTime: 10 * 60_000, retry: 1 })
  const tokenCount = tokens.data ? Math.max(0, tokens.data.length - 1) : null

  const currentPreset = PROMPT_PRESETS[selectedIdx]
  const displayCommand = customText || currentPreset.command

  const handleSelectPreset = (idx: number) => {
    setSelectedIdx(idx)
    setCustomText('')
    setActiveStep('plan')
  }

  const handleRunPreset = () => {
    setAgentPrefill(displayCommand)
    onAgent()
  }

  return (
    <section className="pt-2 sm:pt-6">
      {/* Hyperliquid network header pill */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <div className="inline-flex items-center gap-2 border border-line bg-panel px-3 py-1 font-mono font-bold text-ink">
          <span className="h-2 w-2 animate-pulse bg-up" aria-hidden="true" />
          <span>BUILT ON ARC BLOCKCHAIN</span>
        </div>
        <span className="font-mono text-[11px] text-mute">
          Chain ID: 5042 · Gas Token: USDC · Deterministic Finality
        </span>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10">
        <div>
          <h1 className="text-4xl font-display uppercase leading-[0.98] sm:text-6xl lg:text-[4.2rem]">
            The Agentic Trading Terminal on Arc.
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-mute sm:text-base">
            High-performance non-custodial trading on the Arc network. Execute best-route market swaps, automated conditional orders (Limit, Stop-Loss, Trailing, OCO), and recurring DCA via smart contract escrow or natural-language prompts.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              onClick={onTrade}
              className="press inline-flex min-h-[50px] items-center gap-2 border border-line bg-accent px-6 text-sm font-bold text-accent-ink shadow-hard hover:opacity-95"
            >
              <span>LAUNCH TERMINAL</span>
              <ArrowUpRight className="h-4 w-4" />
            </button>
            <button
              onClick={onAgent}
              className="press inline-flex min-h-[50px] items-center gap-2 border border-line bg-panel px-6 text-sm font-bold text-ink shadow-hard-sm hover:bg-raised"
            >
              <TerminalIcon className="h-4 w-4" />
              <span>AGENT STATION</span>
            </button>
          </div>

          {/* Quick proof badges */}
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line/60 pt-4 text-xs font-mono text-mute">
            <div className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-up" />
              <span>100% Self-Custodial Escrow</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-up" />
              <span>0x & KyberSwap v2 Aggregation</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-up" />
              <span>Chainlink Oracle Triggers</span>
            </div>
          </div>
        </div>

        {/* Hyperliquid-style Prompt & Agent Interactive Showcase */}
        <div className="border border-line bg-panel shadow-hard-lg">
          <div className="flex items-center justify-between border-b border-line bg-ink px-4 py-2.5 text-canvas">
            <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider">
              <TerminalIcon className="h-4 w-4 text-accent" />
              <span>Agent Prompt Terminal</span>
            </div>
            <span className="font-mono text-[10px] uppercase text-canvas/70">
              Arc Native Execution
            </span>
          </div>

          <div className="p-4 sm:p-5">
            {/* Interactive Prompt Selector Bar */}
            <div className="mb-3">
              <span className="mb-1.5 block font-mono text-[11px] font-bold text-mute uppercase">
                Select Prompt Scenario:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {PROMPT_PRESETS.map((p, idx) => (
                  <button
                    key={p.label}
                    onClick={() => handleSelectPreset(idx)}
                    className={clsx(
                      'border border-line px-2.5 py-1 font-mono text-xs font-bold transition',
                      selectedIdx === idx
                        ? 'bg-accent text-accent-ink shadow-hard-sm'
                        : 'bg-raised text-mute hover:text-ink',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt Input Box */}
            <div className="border border-line bg-ink p-3 text-canvas font-mono text-xs sm:text-sm">
              <div className="flex items-center gap-2 text-accent">
                <span className="font-bold">&gt;</span>
                <input
                  type="text"
                  value={displayCommand}
                  onChange={(e) => setCustomText(e.target.value)}
                  className="w-full bg-transparent text-canvas outline-none"
                  placeholder="Type trading command or prompt..."
                />
              </div>
            </div>

            {/* Simulated Live Plan Synthesis */}
            <div className="mt-3 border border-line bg-raised p-3">
              <div className="flex items-center justify-between border-b border-line/50 pb-2">
                <span className="font-mono text-[11px] font-bold uppercase text-ink">
                  Intent: {currentPreset.intent}
                </span>
                <span className="inline-block bg-accent px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent-ink">
                  Verified Plan
                </span>
              </div>

              <div className="mt-2 divide-y divide-line/30">
                {currentPreset.lines.map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1 font-mono text-xs">
                    <span className="text-mute">{k}</span>
                    <span className="font-bold text-ink">{v}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-line/40 pt-2.5">
                <span className="text-[11px] text-mute font-mono">
                  Wallet signature required for execution
                </span>
                <button
                  onClick={handleRunPreset}
                  className="press border border-line bg-accent px-3 py-1 font-mono text-xs font-bold text-accent-ink shadow-hard-sm hover:opacity-90"
                >
                  Execute in Agent &gt;
                </button>
              </div>
            </div>

            <div className="mt-3 text-[11px] text-mute flex items-center justify-between">
              <span>Status: Ready on Arc Network</span>
              <span className="font-mono text-up font-bold">Strict Grammar Gate Active</span>
            </div>
          </div>
        </div>
      </div>

      {/* Hyperliquid-style Live Stats Strip (Fluid Width) */}
      <div className="mt-12 grid grid-cols-2 border border-line bg-panel lg:grid-cols-5 shadow-hard-sm">
        <div className="border-b border-line p-4 sm:p-5 sm:border-b-0 lg:border-r">
          <span className="block font-mono text-[11px] font-bold text-mute uppercase">L1 Ecosystem</span>
          <span className="mt-1 block font-display text-xl sm:text-2xl text-ink">Arc Blockchain</span>
          <span className="text-[11px] text-mute font-mono">Chain 5042 / 5042002</span>
        </div>
        <div className="border-b border-line p-4 sm:p-5 sm:border-b-0 border-l border-line lg:border-r">
          <span className="block font-mono text-[11px] font-bold text-mute uppercase">Routable Assets</span>
          <span className="mt-1 block font-display text-xl sm:text-2xl text-ink">
            {tokenCount === null ? (tokens.isError ? '60+' : '...') : `${tokenCount}+ Tokens`}
          </span>
          <span className="text-[11px] text-mute font-mono">0x & KyberSwap Registry</span>
        </div>
        <div className="border-b border-line p-4 sm:p-5 sm:border-b-0 lg:border-r border-t sm:border-t-0">
          <span className="block font-mono text-[11px] font-bold text-mute uppercase">Order Architecture</span>
          <span className="mt-1 block font-display text-xl sm:text-2xl text-ink">6 Types + DCA</span>
          <span className="text-[11px] text-mute font-mono">On-chain Escrow Contract</span>
        </div>
        <div className="border-b border-line p-4 sm:p-5 sm:border-b-0 border-l border-line lg:border-r border-t sm:border-t-0">
          <span className="block font-mono text-[11px] font-bold text-mute uppercase">Execution Fee</span>
          <span className="mt-1 block font-display text-xl sm:text-2xl text-ink">0.10% Cap</span>
          <span className="text-[11px] text-mute font-mono">Permissible Lower-Only</span>
        </div>
        <div className="col-span-2 p-4 sm:p-5 lg:col-span-1 border-t sm:border-t lg:border-t-0">
          <span className="block font-mono text-[11px] font-bold text-mute uppercase">Custody Protocol</span>
          <span className="mt-1 block font-display text-xl sm:text-2xl text-up">100% Non-Custodial</span>
          <span className="text-[11px] text-mute font-mono">Direct Wallet Authorization</span>
        </div>
      </div>
    </section>
  )
}

// ---------- 2. core terminal features (Hyperliquid matrix) ----------

const TERMINAL_MODULES = [
  {
    code: 'AGG-01',
    title: 'Spot DEX Aggregation',
    tag: 'Best Output Routing',
    desc: 'Parallel quoting engine querying 0x AllowanceHolder and KyberSwap v2. Quotes are evaluated by net guaranteed tokens minus gas costs with instant on-chain simulation before presentation.',
  },
  {
    code: 'ORD-02',
    title: 'Escrowed Conditional Orders',
    tag: 'Limit · Stops · OCO',
    desc: 'Limit, Stop-Loss, Take-Profit, Stop-Limit, Trailing-Stop, and OCO. User funds are safely escrowed directly in ArcTradeOrders.sol and filled automatically by decentralized keepers.',
  },
  {
    code: 'DCA-03',
    title: 'Automated DCA Engine',
    tag: 'Recurring Purchases',
    desc: 'Dollar-cost averaging schedules across hourly, daily, weekly, or monthly cadences. Supports maximum price ceiling guards so capital is preserved during localized market spikes.',
  },
  {
    code: 'AGT-04',
    title: 'Autonomous Agent Station',
    tag: 'Deterministic Prompts',
    desc: 'Natural language trading terminal driven by a formal, deterministic command grammar. Resolves symbols, builds verified execution plans, enforces daily budgets, and protects private keys.',
  },
]

function CoreTerminalFeatures({ onSelectAction }: { onSelectAction: (cmd: string) => void }) {
  return (
    <section>
      <SectionHeader
        kicker="Terminal Matrix"
        title="Engineered for high-frequency on-chain control."
        desc="All trading execution modules run on Arc blockchain infrastructure with zero counterparty custodial risk."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TERMINAL_MODULES.map((mod) => (
          <Reveal key={mod.code}>
            <div className="flex h-full flex-col justify-between border border-line bg-panel p-5 shadow-hard-sm hover:bg-raised/50 transition">
              <div>
                <div className="flex items-center justify-between border-b border-line pb-2.5">
                  <span className="font-mono text-xs font-bold text-mute">{mod.code}</span>
                  <span className="bg-raised border border-line px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink">
                    {mod.tag}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-bold font-display uppercase tracking-tight text-ink">
                  {mod.title}
                </h3>
                <p className="mt-2 text-xs sm:text-sm text-mute leading-relaxed">{mod.desc}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

// ---------- 3. Built on Arc Ecosystem Showcase ----------

function BuiltOnArcShowcase() {
  const ARC_PILLARS = [
    {
      title: 'Native USDC Gas Economy',
      detail: 'On Arc, the native gas currency is USDC at 18 decimals, unified with 6-decimal ERC-20 USDC. Traders maintain a single currency pool for fees and liquidity without wrapping.',
    },
    {
      title: 'Sub-Second Finality',
      detail: 'Arc features deterministic block finality. Keepers can execute triggered limit and trailing orders without the latency, reorgs, or MEV sandwich vulnerabilities found on legacy L1s.',
    },
    {
      title: 'Chainlink Data Feeds',
      detail: 'On-chain order condition validation relies directly on Arc Chainlink oracles with round completeness checks (answeredInRound >= roundId) and maximum staleness constraints.',
    },
    {
      title: 'Permissionless Keeper Network',
      detail: 'Execution is open to any autonomous keeper node. Keepers earn up to 0.10% protocol fees for executing valid orders, incentivizing a decentralized bot ecosystem.',
    },
  ]

  return (
    <section>
      <SectionHeader
        kicker="Blockchain Infrastructure"
        title="Why Lumarc is built natively on Arc."
        desc="Arc network provides the architectural primitives required for institutional-grade non-custodial trading."
      />

      <div className="border border-line bg-panel shadow-hard">
        <div className="grid border-b border-line bg-ink px-4 py-3 text-canvas sm:grid-cols-2">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-accent">
            Arc Architectural Advantage
          </span>
          <span className="hidden sm:block text-right font-mono text-xs text-canvas/70">
            Network Specification
          </span>
        </div>

        <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 sm:divide-x">
          <div className="divide-y divide-line">
            {ARC_PILLARS.slice(0, 2).map((p) => (
              <div key={p.title} className="p-5 sm:p-6">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 bg-up" aria-hidden="true" />
                  <h3 className="font-bold font-display uppercase tracking-tight text-ink sm:text-base">
                    {p.title}
                  </h3>
                </div>
                <p className="mt-2 text-xs sm:text-sm text-mute leading-relaxed">{p.detail}</p>
              </div>
            ))}
          </div>

          <div className="divide-y divide-line">
            {ARC_PILLARS.slice(2, 4).map((p) => (
              <div key={p.title} className="p-5 sm:p-6">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 bg-up" aria-hidden="true" />
                  <h3 className="font-bold font-display uppercase tracking-tight text-ink sm:text-base">
                    {p.title}
                  </h3>
                </div>
                <p className="mt-2 text-xs sm:text-sm text-mute leading-relaxed">{p.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------- 4. Agentic Prompt Workflow Section ----------

function AgenticWorkflow({ onAgent }: { onAgent: () => void }) {
  const STEPS = [
    {
      step: '01',
      title: 'Prompt or Command',
      desc: 'Type your intent in plain language ("buy $100 of btc if it drops 5%") or use formal terminal commands. No external LLM key is needed.',
    },
    {
      step: '02',
      title: 'Deterministic Verification',
      desc: 'The browser parser validates token feeds, checks your real wallet balance, quotes current aggregator liquidity, and calculates exact minimum outputs.',
    },
    {
      step: '03',
      title: 'Readback Confirmation',
      desc: 'The agent presents an exact numeric breakdown and explicitly asks "Is this exactly what you want?". You reply yes or click cancel.',
    },
    {
      step: '04',
      title: 'On-Chain Execution',
      desc: 'Your connected Web3 wallet prompts for signature. The agent never holds private keys, cannot bypass approval, and respects custom daily spending caps.',
    },
  ]

  return (
    <section>
      <SectionHeader
        kicker="Agentic Workflow"
        title="How prompt-driven trading operates."
        desc="Safe, deterministic execution pipeline connecting conversational intents directly to smart contracts."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <div key={s.step} className="border border-line bg-panel p-5 shadow-hard-sm">
            <span className="font-mono text-xs font-bold text-accent-ink bg-accent px-2 py-0.5 inline-block">
              STEP {s.step}
            </span>
            <h3 className="mt-3 text-base font-bold font-display uppercase text-ink">
              {s.title}
            </h3>
            <p className="mt-2 text-xs sm:text-sm text-mute leading-relaxed">{s.desc}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-start">
        <button
          onClick={onAgent}
          className="press inline-flex min-h-[46px] items-center gap-2 border border-line bg-ink px-5 text-xs sm:text-sm font-bold text-canvas shadow-hard hover:opacity-90"
        >
          <TerminalIcon className="h-4 w-4 text-accent" />
          <span>OPEN AGENT STATION TO TRY PROMPTS</span>
        </button>
      </div>
    </section>
  )
}

// ---------- 5. Security & Trust Architecture ----------

function SecurityMatrix() {
  return (
    <section>
      <SectionHeader
        kicker="Security Protocol"
        title="Non-custodial by contract design."
        desc="Funds remain entirely within your wallet or locked in verified contract escrow."
      />

      <div className="grid border border-line bg-panel shadow-hard md:grid-cols-2">
        <div className="p-5 sm:p-6">
          <div className="mb-2 inline-block border border-line bg-ink px-2.5 py-0.5 font-mono text-xs font-bold text-canvas">
            YOUR WALLET &amp; PERMISSIONS
          </div>
          <h3 className="text-xl font-bold font-display uppercase">Client-Side Sovereignty</h3>
          <ul className="mt-4 space-y-3 text-xs sm:text-sm text-ink/90">
            <li className="flex items-start gap-2.5">
              <span className="mt-1 h-2 w-2 shrink-0 bg-ink" aria-hidden="true" />
              <span><strong>Zero custodian deposits:</strong> Market swaps route directly from your wallet to aggregator routers in a single atomic transaction.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1 h-2 w-2 shrink-0 bg-ink" aria-hidden="true" />
              <span><strong>Mandatory transaction signing:</strong> Every single trade, approval, and order registration requires direct cryptographic signature from your wallet.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1 h-2 w-2 shrink-0 bg-ink" aria-hidden="true" />
              <span><strong>Instant refundability:</strong> Orders and DCA balances can be cancelled at any time by the owner for an immediate 100% principal return, even when the contract is paused.</span>
            </li>
          </ul>
        </div>

        <div className="border-t border-line bg-raised/40 p-5 sm:p-6 md:border-l md:border-t-0">
          <div className="mb-2 inline-block border border-line bg-panel px-2.5 py-0.5 font-mono text-xs font-bold text-ink">
            SMART CONTRACT VERIFICATION
          </div>
          <h3 className="text-xl font-bold font-display uppercase">On-Chain Guarantees</h3>
          <ul className="mt-4 space-y-3 text-xs sm:text-sm text-mute">
            <li className="flex items-start gap-2.5">
              <span className="mt-1 h-2 w-2 shrink-0 border border-line bg-canvas" aria-hidden="true" />
              <span><strong>Balance delta verification:</strong> ArcTradeOrders checks exact token balance differences before and after execution to prevent fee-on-transfer and slippage exploits.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1 h-2 w-2 shrink-0 border border-line bg-canvas" aria-hidden="true" />
              <span><strong>Timelocked administration:</strong> Any operator changes (new token feeds or routers) require a public timelock delay (minimum 48h recommended for mainnet).</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1 h-2 w-2 shrink-0 border border-line bg-canvas" aria-hidden="true" />
              <span><strong>Irreversible fee policy:</strong> The 0.10% keeper fee can only ever be lowered by governance, never raised.</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  )
}

// ---------- 6. Curated FAQ (Hyperliquid style) ----------

const HYPER_FAQ = [
  {
    q: 'Does Lumarc hold user funds or custody private keys?',
    a: 'No. Lumarc is entirely non-custodial. Market swaps execute atomic settlement through aggregator contracts directly to your wallet. Conditional orders and DCA plans escrow funds inside ArcTradeOrders.sol, where only you possess the authority to cancel, pause, or withdraw.',
  },
  {
    q: 'How does prompt trading work without hallucinating orders?',
    a: 'Lumarc uses a deterministic grammar engine rather than delegating trade creation to an unconstrained LLM. The agent parses your natural language prompt into exact parameters, quotes live Chainlink feeds and aggregator routes, builds a fixed plan, and requires your explicit confirmation before requesting wallet signature.',
  },
  {
    q: 'How are conditional orders and DCA plans executed on Arc?',
    a: 'Execution is permissionless. Independent keeper nodes continuously monitor oracle conditions and scheduled DCA intervals. When conditions are satisfied, a keeper submits the execution transaction and receives a protocol fee capped at 0.10%. Lumarc operates an integrated keeper, and any user can run their own.',
  },
  {
    q: 'Can I test all features without risking real capital?',
    a: 'Yes. Switch network to Arc Testnet in the top navigation. You can mint test tokens from the faucet, manipulate live test feeds to trigger limit or stop conditions, and observe keeper execution with zero financial risk.',
  },
] as const

function CuratedFaq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section>
      <SectionHeader
        kicker="FAQ"
        title="Frequently asked questions."
        desc="Core answers regarding non-custodial protocol mechanics, prompts, and execution on Arc."
      />

      <div className="border border-line bg-panel shadow-hard-sm">
        {HYPER_FAQ.map((f, i) => (
          <div key={f.q} className={clsx(i > 0 && 'border-t border-line')}>
            <h3>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}
                className="flex min-h-[54px] w-full items-center justify-between gap-4 px-4 py-3.5 text-left font-sans text-sm sm:text-base font-bold hover:bg-raised transition"
              >
                <span>{f.q}</span>
                <span className="num font-mono text-base font-bold" aria-hidden="true">
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

// ---------- 7. Hyperliquid-style Launch Banner (CTA) ----------

function LaunchTerminalBanner({ onTrade, onAgent }: { onTrade: () => void; onAgent: () => void }) {
  return (
    <section>
      <div className="border border-line bg-ink p-6 text-canvas shadow-hard-lg sm:p-10 lg:p-12">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="bg-accent text-accent-ink font-mono text-[10px] font-bold px-2 py-0.5 uppercase">
            ARC NETWORK DEPLOYMENT
          </span>
          <span className="text-canvas/70 font-mono text-xs">Testnet live · Mainnet ready</span>
        </div>

        <h2 className="text-3xl sm:text-5xl lg:text-6xl font-display uppercase leading-[0.98] max-w-3xl">
          Start trading with agentic precision on Arc.
        </h2>
        <p className="mt-4 max-w-xl text-xs sm:text-sm text-canvas/80 leading-relaxed font-mono">
          Connect your Web3 wallet to access DEX market aggregation, conditional orders, DCA accumulation, and the Agent Station.
        </p>

        <div className="mt-7 flex flex-wrap gap-3">
          <button
            onClick={onTrade}
            className="press inline-flex min-h-[50px] items-center gap-2 border border-canvas bg-accent px-6 text-sm font-bold text-accent-ink shadow-[3px_3px_0_0_rgb(var(--bg))]"
          >
            <span>LAUNCH APP</span>
            <ArrowUpRight className="h-4 w-4" />
          </button>
          <button
            onClick={onAgent}
            className="press inline-flex min-h-[50px] items-center gap-2 border border-canvas bg-transparent px-6 text-sm font-bold text-canvas hover:bg-canvas hover:text-ink transition"
          >
            <TerminalIcon className="h-4 w-4" />
            <span>TRY AGENT PROMPTS</span>
          </button>
          <a
            href={BRAND.links.docs}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[50px] items-center border border-canvas/40 px-5 text-sm font-bold text-canvas/80 hover:border-canvas hover:text-canvas transition"
          >
            Documentation
          </a>
        </div>
      </div>
    </section>
  )
}

// ---------- main landing page export ----------

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
    <div className="w-full space-y-16 sm:space-y-24 pb-12">
      <Hero onTrade={() => setPage('trade')} onAgent={() => setPage('agent')} />
      <CoreTerminalFeatures onSelectAction={tryCommand} />
      <BuiltOnArcShowcase />
      <AgenticWorkflow onAgent={() => setPage('agent')} />
      <SecurityMatrix />
      <CuratedFaq />
      <LaunchTerminalBanner onTrade={() => setPage('trade')} onAgent={() => setPage('agent')} />
    </div>
  )
}
