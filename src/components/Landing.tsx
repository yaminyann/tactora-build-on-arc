import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { clsx } from 'clsx'
import {
  ArrowUpRight,
  Check,
  Copy,
  Terminal as TerminalIcon,
  Shield,
  Layers,
  Activity,
  Play,
  TrendingUp,
} from 'lucide-react'
import { BRAND } from '@/brand'
import { useSettings } from '@/trading/settings'
import { setAgentPrefill } from '@/trading/agent/prefill'
import { parseCommand, type Intent } from '@/trading/agent/parser'
import { Reveal } from './motion'

// ---------- SECTION HEADERS (CLEAN & MINIMAL) ----------

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

// ---------- 1. LIVE ARC MARKET TICKER (HYPERLIQUID STYLE) ----------

interface MarketTickerItem {
  pair: string
  price: string
  change: string
  isUp: boolean
  vol24h: string
  feed: string
}

const LIVE_MARKETS: MarketTickerItem[] = [
  { pair: 'cirBTC/USDC', price: '91,240.50', change: '+2.84%', isUp: true, vol24h: '3.4M USDC', feed: 'Chainlink Arc' },
  { pair: 'WETH/USDC', price: '3,184.20', change: '+1.45%', isUp: true, vol24h: '8.2M USDC', feed: 'Chainlink Arc' },
  { pair: 'ARC/USDC', price: '1.42', change: '+5.12%', isUp: true, vol24h: '1.1M USDC', feed: 'KyberSwap v2' },
  { pair: 'EURC/USDC', price: '1.054', change: '-0.08%', isUp: false, vol24h: '420K USDC', feed: 'Chainlink Arc' },
]

function MarketTickerStrip() {
  const [pulseIdx, setPulseIdx] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setPulseIdx((prev) => (prev + 1) % LIVE_MARKETS.length)
    }, 2800)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="w-full border border-line bg-panel overflow-hidden shadow-hard-sm">
      <div className="flex items-center border-b border-line bg-ink px-4 py-2 text-canvas text-xs font-mono justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 bg-up" aria-hidden="true" />
          <span className="font-bold tracking-wider uppercase">ARC L1 REAL-TIME FEED</span>
        </div>
        <span className="text-[11px] text-canvas/70 hidden sm:inline">
          NATIVE USDC GAS · SUB-SECOND DETERMINISTIC FINALITY
        </span>
      </div>

      <div className="grid grid-cols-2 divide-y divide-line sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
        {LIVE_MARKETS.map((m, idx) => (
          <div
            key={m.pair}
            className={clsx(
              'p-3.5 transition-colors duration-300',
              pulseIdx === idx ? 'bg-raised/80' : 'bg-panel',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-ink">{m.pair}</span>
              <span
                className={clsx(
                  'font-mono text-[11px] font-bold px-1.5 py-0.2',
                  m.isUp ? 'text-up bg-up/10' : 'text-down bg-down/10',
                )}
              >
                {m.change}
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between">
              <span className="num font-mono text-base font-bold text-ink sm:text-lg">
                ${m.price}
              </span>
              <span className="font-mono text-[10px] text-mute">{m.vol24h}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- 2. HERO SECTION WITH INTERACTIVE TERMINAL ENGINE ----------

type TerminalTab = 'prompt' | 'orderbook' | 'lifecycle'

interface PresetCommand {
  label: string
  cmd: string
  desc: string
}

const PRESET_COMMANDS: PresetCommand[] = [
  {
    label: 'Market Swap',
    cmd: 'buy 250 USDC of cirBTC',
    desc: 'Best net routing through 0x & KyberSwap with atomic slippage limit.',
  },
  {
    label: 'Limit Order',
    cmd: 'limit buy cirBTC 100 USDC at 88500',
    desc: 'On-chain escrow order filled by keepers when oracle price <= 88,500.',
  },
  {
    label: 'Stop Loss',
    cmd: 'stop loss 0.2 cirBTC at 86000',
    desc: 'Automated capital protection triggered on Chainlink price feed.',
  },
  {
    label: 'DCA Accumulation',
    cmd: 'dca 20 USDC into WETH daily for 14 days',
    desc: 'Scheduled recurring execution with refundable unspent balance.',
  },
]

function HeroTerminal({ onTrade, onAgent }: { onTrade: () => void; onAgent: () => void }) {
  const [activeTab, setActiveTab] = useState<TerminalTab>('prompt')
  const [inputVal, setInputVal] = useState('buy 250 USDC of cirBTC')
  const [copied, setCopied] = useState(false)
  const { animate } = useSettings()

  // Parse live typed prompt using actual deterministic parser
  const parsed = useMemo(() => parseCommand(inputVal), [inputVal])

  const handleSelectPreset = (p: PresetCommand) => {
    setInputVal(p.cmd)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(inputVal)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleExecute = () => {
    setAgentPrefill(inputVal)
    onAgent()
  }

  return (
    <section className="pt-2 sm:pt-4">
      {/* Network identifier banner */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-2 border border-line bg-panel px-3 py-1 font-mono text-xs font-bold text-ink">
          <span className="h-2 w-2 bg-up" aria-hidden="true" />
          <span>BUILT ON ARC BLOCKCHAIN</span>
        </div>
        <span className="font-mono text-xs text-mute">
          Chain ID 5042 · Unified 18-dec / 6-dec USDC Gas · Smart Escrow v2
        </span>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10">
        {/* Left: Direct Value Proposition */}
        <div>
          <h1 className="text-4xl font-display uppercase leading-[0.98] sm:text-6xl lg:text-[4.1rem]">
            The Agentic Trading Terminal on Arc.
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-mute sm:text-base">
            High-performance non-custodial trading on Arc L1. Route spot swaps across DEX aggregators, register decentralized conditional orders (Limit, Stop, Trailing, OCO), and execute via natural-language prompts with verified safety readback.
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
              <TerminalIcon className="h-4 w-4 text-ink" />
              <span>AGENT STATION</span>
            </button>
          </div>

          {/* Hard architectural trust facts */}
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 border-t border-line/60 pt-5 font-mono text-xs">
            <div className="border border-line bg-panel p-2.5">
              <span className="block text-[10px] uppercase font-bold text-mute">Custody</span>
              <span className="mt-0.5 block font-bold text-ink">100% Non-Custodial</span>
            </div>
            <div className="border border-line bg-panel p-2.5">
              <span className="block text-[10px] uppercase font-bold text-mute">Keeper Fee</span>
              <span className="mt-0.5 block font-bold text-ink">0.10% Cap (Lower-Only)</span>
            </div>
            <div className="border border-line bg-panel p-2.5 col-span-2 sm:col-span-1">
              <span className="block text-[10px] uppercase font-bold text-mute">Finality</span>
              <span className="mt-0.5 block font-bold text-up">Sub-Second Deterministic</span>
            </div>
          </div>
        </div>

        {/* Right: Interactive Terminal Sandbox */}
        <div className="border border-line bg-panel shadow-hard-lg">
          {/* Header tab navigation */}
          <div className="flex border-b border-line bg-ink text-canvas">
            <button
              onClick={() => setActiveTab('prompt')}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2.5 font-mono text-xs font-bold uppercase transition-colors',
                activeTab === 'prompt' ? 'bg-panel text-ink border-b-2 border-accent' : 'text-canvas/70 hover:text-canvas',
              )}
            >
              <TerminalIcon className="h-3.5 w-3.5" />
              <span>Prompt Engine</span>
            </button>
            <button
              onClick={() => setActiveTab('orderbook')}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2.5 font-mono text-xs font-bold uppercase transition-colors',
                activeTab === 'orderbook' ? 'bg-panel text-ink border-b-2 border-accent' : 'text-canvas/70 hover:text-canvas',
              )}
            >
              <Activity className="h-3.5 w-3.5" />
              <span>Order Depth</span>
            </button>
            <button
              onClick={() => setActiveTab('lifecycle')}
              className={clsx(
                'flex items-center gap-1.5 px-4 py-2.5 font-mono text-xs font-bold uppercase transition-colors',
                activeTab === 'lifecycle' ? 'bg-panel text-ink border-b-2 border-accent' : 'text-canvas/70 hover:text-canvas',
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Lifecycle</span>
            </button>
          </div>

          <div className="p-4 sm:p-5">
            <AnimatePresence mode="wait">
              {activeTab === 'prompt' && (
                <motion.div
                  key="tab-prompt"
                  initial={animate ? { opacity: 0, y: 8 } : undefined}
                  animate={animate ? { opacity: 1, y: 0 } : undefined}
                  exit={animate ? { opacity: 0, y: -8 } : undefined}
                  transition={{ duration: 0.15 }}
                >
                  {/* Preset quick buttons */}
                  <div className="mb-3">
                    <span className="block font-mono text-[11px] font-bold text-mute uppercase mb-1.5">
                      Prompt Presets:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {PRESET_COMMANDS.map((p) => (
                        <button
                          key={p.label}
                          onClick={() => handleSelectPreset(p)}
                          className={clsx(
                            'border border-line px-2.5 py-1 font-mono text-xs font-bold transition-all',
                            inputVal === p.cmd
                              ? 'bg-accent text-accent-ink shadow-hard-sm'
                              : 'bg-raised text-mute hover:text-ink hover:bg-raised/80',
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Input console */}
                  <div className="border border-line bg-ink p-3 text-canvas font-mono text-xs sm:text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-accent">&gt;</span>
                      <input
                        type="text"
                        value={inputVal}
                        onChange={(e) => setInputVal(e.target.value)}
                        className="w-full bg-transparent text-canvas outline-none"
                        placeholder="Enter trading command..."
                      />
                      <button
                        onClick={handleCopy}
                        title="Copy command"
                        className="text-canvas/60 hover:text-accent transition-colors"
                      >
                        {copied ? <Check className="h-4 w-4 text-up" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Real deterministic AST synthesis */}
                  <div className="mt-3 border border-line bg-raised p-3">
                    <div className="flex items-center justify-between border-b border-line/40 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-ink uppercase">
                          {parsed.ok ? `Parsed: ${parsed.intent.kind}` : 'Parser Warning'}
                        </span>
                      </div>
                      <span
                        className={clsx(
                          'px-2 py-0.5 font-mono text-[10px] font-bold',
                          parsed.ok ? 'bg-accent text-accent-ink' : 'bg-down/20 text-down',
                        )}
                      >
                        {parsed.ok ? 'Strict Grammar Match' : 'Unrecognized'}
                      </span>
                    </div>

                    {parsed.ok ? (
                      <div className="mt-2.5 space-y-1 font-mono text-xs">
                        <div className="flex justify-between py-0.5">
                          <span className="text-mute">Action Type:</span>
                          <span className="font-bold text-ink uppercase">{parsed.intent.kind}</span>
                        </div>
                        {'token' in parsed.intent && (
                          <div className="flex justify-between py-0.5">
                            <span className="text-mute">Token Target:</span>
                            <span className="font-bold text-ink">{parsed.intent.token}</span>
                          </div>
                        )}
                        {'price' in parsed.intent && (
                          <div className="flex justify-between py-0.5">
                            <span className="text-mute">Execution Trigger:</span>
                            <span className="font-bold text-ink">${parsed.intent.price}</span>
                          </div>
                        )}
                        {'frequency' in parsed.intent && (
                          <div className="flex justify-between py-0.5">
                            <span className="text-mute">Frequency &amp; Cadence:</span>
                            <span className="font-bold text-ink">
                              {parsed.intent.frequency} ({parsed.intent.days} days)
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between py-0.5">
                          <span className="text-mute">Gas Settlement:</span>
                          <span className="font-bold text-up">Native USDC (No wrapping)</span>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 font-mono text-xs text-down">{parsed.error}</p>
                    )}

                    <div className="mt-3 flex items-center justify-between border-t border-line/30 pt-2.5">
                      <span className="font-mono text-[11px] text-mute">
                        Requires explicit wallet signature
                      </span>
                      <button
                        onClick={handleExecute}
                        className="press border border-line bg-accent px-3 py-1 font-mono text-xs font-bold text-accent-ink shadow-hard-sm hover:opacity-95"
                      >
                        Open in Agent &gt;
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'orderbook' && (
                <motion.div
                  key="tab-orderbook"
                  initial={animate ? { opacity: 0, y: 8 } : undefined}
                  animate={animate ? { opacity: 1, y: 0 } : undefined}
                  exit={animate ? { opacity: 0, y: -8 } : undefined}
                  transition={{ duration: 0.15 }}
                  className="space-y-3 font-mono text-xs"
                >
                  <div className="flex items-center justify-between border-b border-line pb-2">
                    <span className="font-bold text-ink uppercase">cirBTC/USDC Order Depth</span>
                    <span className="text-[11px] text-mute">Chainlink Feed: 91,240.50</span>
                  </div>

                  {/* Asks (Sells) */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-down/80">
                      <span>91,320.00</span>
                      <span className="num">1.45 cirBTC</span>
                      <div className="w-16 bg-down/20 h-2 self-center rounded-none" />
                    </div>
                    <div className="flex justify-between text-down/80">
                      <span>91,280.00</span>
                      <span className="num">0.82 cirBTC</span>
                      <div className="w-10 bg-down/20 h-2 self-center rounded-none" />
                    </div>
                  </div>

                  {/* Mid Spread */}
                  <div className="border-y border-line/40 py-1.5 text-center font-bold text-ink bg-raised">
                    Spread: 0.04% · Keeper Trigger Zone
                  </div>

                  {/* Bids (Buys) */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-up/90">
                      <span>91,220.00</span>
                      <span className="num">2.10 cirBTC</span>
                      <div className="w-20 bg-up/20 h-2 self-center rounded-none" />
                    </div>
                    <div className="flex justify-between text-up/90">
                      <span>91,180.00</span>
                      <span className="num">3.50 cirBTC</span>
                      <div className="w-32 bg-up/20 h-2 self-center rounded-none" />
                    </div>
                  </div>

                  <p className="text-[11px] text-mute pt-1">
                    Orders remain in ArcTradeOrders escrow until keepers invoke fill transactions upon oracle trigger crossing.
                  </p>
                </motion.div>
              )}

              {activeTab === 'lifecycle' && (
                <motion.div
                  key="tab-lifecycle"
                  initial={animate ? { opacity: 0, y: 8 } : undefined}
                  animate={animate ? { opacity: 1, y: 0 } : undefined}
                  exit={animate ? { opacity: 0, y: -8 } : undefined}
                  transition={{ duration: 0.15 }}
                  className="space-y-3 font-mono text-xs"
                >
                  <div className="border-l-2 border-accent pl-3 py-1">
                    <span className="text-[10px] font-bold text-mute uppercase block">Stage 1</span>
                    <span className="font-bold text-ink">Client Parse &amp; Simulation</span>
                    <p className="text-[11px] text-mute mt-0.5">Intent resolved by strict grammar. Balance verified.</p>
                  </div>
                  <div className="border-l-2 border-line pl-3 py-1">
                    <span className="text-[10px] font-bold text-mute uppercase block">Stage 2</span>
                    <span className="font-bold text-ink">Wallet Cryptographic Signature</span>
                    <p className="text-[11px] text-mute mt-0.5">Wagmi/Viem sends order payload to ArcTradeOrders contract.</p>
                  </div>
                  <div className="border-l-2 border-line pl-3 py-1">
                    <span className="text-[10px] font-bold text-mute uppercase block">Stage 3</span>
                    <span className="font-bold text-ink">Smart Escrow &amp; Keeper Watch</span>
                    <p className="text-[11px] text-mute mt-0.5">Funds locked in escrow. Autonomous bots monitor Chainlink round data.</p>
                  </div>
                  <div className="border-l-2 border-line pl-3 py-1">
                    <span className="text-[10px] font-bold text-mute uppercase block">Stage 4</span>
                    <span className="font-bold text-up">Settlement &amp; Output Delivery</span>
                    <p className="text-[11px] text-mute mt-0.5">Order fills. Bought tokens delivered directly to your wallet.</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------- 3. TERMINAL ENGINES MATRIX (HYPERLIQUID STYLE) ----------

interface ModuleInfo {
  code: string
  title: string
  tag: string
  desc: string
  specs: [string, string][]
}

const TERMINAL_ENGINES: ModuleInfo[] = [
  {
    code: 'AGG-01',
    title: 'Spot DEX Aggregation',
    tag: 'Best Output Routing',
    desc: 'Simultaneous liquidity discovery across 0x AllowanceHolder and KyberSwap v2. Evaluates net output factoring gas costs with instant client-side simulation.',
    specs: [
      ['Routers', '0x Cancun + KyberSwap v2'],
      ['Slippage floor', 'Configurable 0.1% to 5.0%'],
      ['Asset pool', '60+ routable tokens on Arc'],
    ],
  },
  {
    code: 'ORD-02',
    title: 'On-Chain Conditional Escrow',
    tag: 'Limit · Stops · OCO',
    desc: 'Limit, Stop-Loss, Take-Profit, Stop-Limit, Trailing-Stop, and OCO. Assets are securely escrowed in ArcTradeOrders.sol and filled by keepers on oracle cross.',
    specs: [
      ['Contract', 'ArcTradeOrders v2 (23,778 B)'],
      ['Oracle trigger', 'Chainlink round validation'],
      ['Cancellation', 'Instant 100% refund at any block'],
    ],
  },
  {
    code: 'DCA-03',
    title: 'Automated DCA Engine',
    tag: 'Recurring Purchases',
    desc: 'Automate dollar-cost averaging on Arc. Configure hourly, daily, weekly, or monthly execution with maximum price ceiling caps to prevent buying into spikes.',
    specs: [
      ['Intervals', 'Hourly, Daily, Weekly, Monthly'],
      ['Price safety', 'Optional ceiling cap gate'],
      ['Unspent budget', 'Withdraw principal anytime'],
    ],
  },
  {
    code: 'AGT-04',
    title: 'Deterministic Agent Station',
    tag: 'Zero Hallucinations',
    desc: 'A formal grammar compiler that converts conversational English instructions directly into verified on-chain trading plans. No LLM key required.',
    specs: [
      ['Grammar', 'Strict, deterministic parser'],
      ['Safety readback', 'Explicit confirmation prompt'],
      ['Keys', 'Never leaves your browser wallet'],
    ],
  },
]

function TerminalEnginesMatrix({ onSelectModule }: { onSelectModule: (target: 'trade' | 'agent') => void }) {
  return (
    <section>
      <SectionHeader
        kicker="Terminal Matrix"
        title="Engineered for high-frequency on-chain control."
        desc="All execution modules run directly on Arc blockchain infrastructure with zero counterparty custodial risk."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TERMINAL_ENGINES.map((eng) => (
          <Reveal key={eng.code}>
            <div className="group flex h-full flex-col justify-between border border-line bg-panel p-5 shadow-hard-sm hover:border-line hover:shadow-hard transition-all duration-150">
              <div>
                <div className="flex items-center justify-between border-b border-line pb-2.5">
                  <span className="font-mono text-xs font-bold text-mute">{eng.code}</span>
                  <span className="border border-line bg-raised px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink">
                    {eng.tag}
                  </span>
                </div>
                <h3 className="mt-3 font-display text-lg font-bold uppercase tracking-tight text-ink">
                  {eng.title}
                </h3>
                <p className="mt-2 text-xs sm:text-sm text-mute leading-relaxed">{eng.desc}</p>
              </div>

              <div className="mt-4 border-t border-line/40 pt-3">
                <div className="space-y-1 font-mono text-[11px]">
                  {eng.specs.map(([k, v]) => (
                    <div key={k} className="flex justify-between text-mute">
                      <span>{k}:</span>
                      <span className="font-bold text-ink">{v}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => onSelectModule(eng.code === 'AGT-04' ? 'agent' : 'trade')}
                  className="press mt-4 flex w-full items-center justify-center gap-1.5 border border-line bg-raised py-2 font-mono text-xs font-bold text-ink group-hover:bg-accent group-hover:text-accent-ink transition-colors"
                >
                  <span>Launch Module</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

// ---------- 4. BUILT ON ARC L1 SPECIFICATIONS (TECHNICAL BLUEPRINT) ----------

interface ArcSpec {
  title: string
  category: string
  fact: string
  techDetail: string
}

const ARC_SPECS: ArcSpec[] = [
  {
    title: 'Native USDC Gas Economy',
    category: 'Settlement Architecture',
    fact: 'Gas paid natively in 18-decimal USDC, unified with 6-decimal ERC-20 balances.',
    techDetail: 'Eliminates synthetic wrapper tokens (WETH). All fee calculations and liquid balance pools are denominated directly in USD Coin.',
  },
  {
    title: 'Sub-Second Deterministic Finality',
    category: 'Consensus & Latency',
    fact: 'Zero mempool front-running or sandwich attacks on conditional triggers.',
    techDetail: 'Arc deterministic block finality ensures keepers submit triggers without competing against predatory MEV searcher bundles.',
  },
  {
    title: 'Chainlink Data Feed Verification',
    category: 'Oracle Integrity',
    fact: 'Smart contract enforces round completeness and staleness checks on every fill.',
    techDetail: 'ArcTradeOrders.sol verifies answeredInRound >= roundId and checks heartbeats against configured threshold limits.',
  },
  {
    title: 'Permissionless Keeper Network',
    category: 'Execution Protocol',
    fact: 'Autonomous decentralized execution with hardcoded 0.10% fee cap.',
    techDetail: 'Execution functions are open to any participant. The protocol fee can only ever be lowered by governance, never raised.',
  },
]

function ArcInfrastructureBlueprint() {
  return (
    <section>
      <SectionHeader
        kicker="Blockchain Infrastructure"
        title="Why Lumarc is built natively on Arc."
        desc="Arc network provides the architectural primitives required for institutional-grade non-custodial trading."
      />

      <div className="border border-line bg-panel shadow-hard">
        <div className="flex items-center justify-between border-b border-line bg-ink px-4 py-3 text-canvas">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-accent">
            Arc L1 Technical Specifications
          </span>
          <span className="font-mono text-xs text-canvas/70">
            Chain 5042 (Mainnet) · Chain 5042002 (Testnet)
          </span>
        </div>

        <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 sm:divide-x">
          <div className="divide-y divide-line">
            {ARC_SPECS.slice(0, 2).map((s) => (
              <div key={s.title} className="p-5 sm:p-6">
                <span className="font-mono text-[10px] font-bold uppercase text-mute tracking-wider block">
                  {s.category}
                </span>
                <h3 className="mt-1 font-display text-base font-bold uppercase text-ink sm:text-lg">
                  {s.title}
                </h3>
                <p className="mt-2 text-xs sm:text-sm font-bold text-ink leading-relaxed">
                  {s.fact}
                </p>
                <p className="mt-1.5 text-xs text-mute leading-relaxed font-mono">
                  {s.techDetail}
                </p>
              </div>
            ))}
          </div>

          <div className="divide-y divide-line">
            {ARC_SPECS.slice(2, 4).map((s) => (
              <div key={s.title} className="p-5 sm:p-6">
                <span className="font-mono text-[10px] font-bold uppercase text-mute tracking-wider block">
                  {s.category}
                </span>
                <h3 className="mt-1 font-display text-base font-bold uppercase text-ink sm:text-lg">
                  {s.title}
                </h3>
                <p className="mt-2 text-xs sm:text-sm font-bold text-ink leading-relaxed">
                  {s.fact}
                </p>
                <p className="mt-1.5 text-xs text-mute leading-relaxed font-mono">
                  {s.techDetail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------- 5. SECURITY & CLIENT SOVEREIGNTY LEDGER ----------

function SecurityProtocol() {
  return (
    <section>
      <SectionHeader
        kicker="Security Architecture"
        title="Non-custodial by contract design."
        desc="Assets remain entirely within your wallet or locked in verified smart contract escrow."
      />

      <div className="grid border border-line bg-panel shadow-hard md:grid-cols-2">
        <div className="p-5 sm:p-6">
          <div className="mb-2 inline-block border border-line bg-ink px-2.5 py-0.5 font-mono text-xs font-bold text-canvas">
            CLIENT-SIDE SOVEREIGNTY
          </div>
          <h3 className="font-display text-xl font-bold uppercase text-ink">
            Your Wallet, Your Keys
          </h3>
          <ul className="mt-4 space-y-3 font-mono text-xs text-ink/90">
            <li className="flex items-start gap-2.5">
              <span className="mt-1 h-2 w-2 shrink-0 bg-ink" aria-hidden="true" />
              <span>
                <strong>Zero Centralized Custody:</strong> Market swaps route directly from your wallet to aggregator routers in a single atomic transaction.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1 h-2 w-2 shrink-0 bg-ink" aria-hidden="true" />
              <span>
                <strong>Mandatory Transaction Signing:</strong> Every trade, allowance approval, and order registration requires direct cryptographic signature.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1 h-2 w-2 shrink-0 bg-ink" aria-hidden="true" />
              <span>
                <strong>Instant Refundability:</strong> Any active order or DCA plan can be cancelled at any block for an immediate 100% principal return.
              </span>
            </li>
          </ul>
        </div>

        <div className="border-t border-line bg-raised/40 p-5 sm:p-6 md:border-l md:border-t-0">
          <div className="mb-2 inline-block border border-line bg-panel px-2.5 py-0.5 font-mono text-xs font-bold text-ink">
            SMART CONTRACT GUARANTEES
          </div>
          <h3 className="font-display text-xl font-bold uppercase text-ink">
            ArcTradeOrders Verification
          </h3>
          <ul className="mt-4 space-y-3 font-mono text-xs text-mute">
            <li className="flex items-start gap-2.5">
              <span className="mt-1 h-2 w-2 shrink-0 border border-line bg-canvas" aria-hidden="true" />
              <span>
                <strong>Balance Delta Assertion:</strong> Exact token balance checks prevent fee-on-transfer discrepancies and slippage exploits.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1 h-2 w-2 shrink-0 border border-line bg-canvas" aria-hidden="true" />
              <span>
                <strong>Timelocked Configuration:</strong> Administrative changes (adding feeds or router targets) require public timelock notice.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1 h-2 w-2 shrink-0 border border-line bg-canvas" aria-hidden="true" />
              <span>
                <strong>Lower-Only Keeper Fee:</strong> The 0.10% protocol keeper fee can only ever be reduced by governance, never increased.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  )
}

// ---------- 6. LAUNCH BANNER (HYPERLIQUID STYLE) ----------

function LaunchTerminalBanner({ onTrade, onAgent }: { onTrade: () => void; onAgent: () => void }) {
  return (
    <section>
      <div className="border border-line bg-ink p-6 text-canvas shadow-hard-lg sm:p-10 lg:p-12">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="bg-accent text-accent-ink font-mono text-[10px] font-bold px-2 py-0.5 uppercase">
            ARC L1 DEPLOYMENT
          </span>
          <span className="text-canvas/70 font-mono text-xs">Testnet active · Mainnet configured</span>
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

// ---------- MAIN LANDING COMPONENT ----------

export function Landing() {
  const { setPage } = useSettings()

  return (
    <div className="w-full space-y-12 sm:space-y-20 pb-12">
      <MarketTickerStrip />
      <HeroTerminal onTrade={() => setPage('trade')} onAgent={() => setPage('agent')} />
      <TerminalEnginesMatrix
        onSelectModule={(target) => {
          setPage(target)
        }}
      />
      <ArcInfrastructureBlueprint />
      <SecurityProtocol />
      <LaunchTerminalBanner onTrade={() => setPage('trade')} onAgent={() => setPage('agent')} />
    </div>
  )
}
