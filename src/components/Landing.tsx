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
  Cpu,
  ChevronRight,
  Database,
  Lock,
  Zap,
} from 'lucide-react'
import { BRAND } from '@/brand'
import { useSettings } from '@/trading/settings'
import { setAgentPrefill } from '@/trading/agent/prefill'
import { parseCommand } from '@/trading/agent/parser'
import { Reveal } from './motion'

// ---------- SECTION HEADERS & KICKERS ----------

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
  { pair: 'cirBTC/USDC', price: '91,420.50', change: '+3.12%', isUp: true, vol24h: '3.8M USDC', feed: 'Chainlink Arc' },
  { pair: 'WETH/USDC', price: '3,210.80', change: '+1.85%', isUp: true, vol24h: '9.4M USDC', feed: 'Chainlink Arc' },
  { pair: 'ARC/USDC', price: '1.45', change: '+6.20%', isUp: true, vol24h: '1.3M USDC', feed: 'KyberSwap v2' },
  { pair: 'EURC/USDC', price: '1.053', change: '-0.12%', isUp: false, vol24h: '510K USDC', feed: 'Chainlink Arc' },
]

function MarketTickerStrip() {
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % LIVE_MARKETS.length)
    }, 2600)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="w-full border border-line bg-panel overflow-hidden shadow-hard-sm">
      <div className="flex items-center border-b border-line bg-ink px-4 py-2 text-canvas text-xs font-mono justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 bg-up" aria-hidden="true" />
          <span className="font-bold tracking-wider uppercase">ARC L1 LIVE EXECUTION STRIP</span>
        </div>
        <span className="text-[11px] text-canvas/70 hidden sm:inline">
          CHAIN ID 5042 · SUB-SECOND DETERMINISTIC FINALITY · NATIVE USDC GAS
        </span>
      </div>

      <div className="grid grid-cols-2 divide-y divide-line sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
        {LIVE_MARKETS.map((m, idx) => (
          <div
            key={m.pair}
            className={clsx(
              'p-3.5 transition-colors duration-300',
              activeIdx === idx ? 'bg-raised/90' : 'bg-panel',
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

// ---------- 2. HERO SECTION & INTERACTIVE TERMINAL ENGINE ----------

type TerminalTab = 'prompt' | 'orderbook' | 'lifecycle'

interface PresetCommand {
  label: string
  cmd: string
  intentLabel: string
}

const PRESET_COMMANDS: PresetCommand[] = [
  {
    label: 'Market Swap',
    cmd: 'buy 250 USDC of cirBTC',
    intentLabel: 'Spot Swap // 0x & KyberSwap v2',
  },
  {
    label: 'Limit Order',
    cmd: 'limit buy cirBTC 100 USDC at 88500',
    intentLabel: 'Conditional Limit // ArcTradeOrders Escrow',
  },
  {
    label: 'Stop Loss',
    cmd: 'stop loss 0.2 cirBTC at 86000',
    intentLabel: 'Stop Loss // Chainlink Oracle Trigger',
  },
  {
    label: 'DCA Accumulation',
    cmd: 'dca 20 USDC into WETH daily for 14 days',
    intentLabel: 'Recurring DCA // Automated Keeper Execution',
  },
]

function HeroTerminal({ onTrade, onAgent }: { onTrade: () => void; onAgent: () => void }) {
  const [activeTab, setActiveTab] = useState<TerminalTab>('prompt')
  const [inputVal, setInputVal] = useState('buy 250 USDC of cirBTC')
  const [copied, setCopied] = useState(false)
  const { animate } = useSettings()

  // Real client-side deterministic AST parse
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
        {/* Left: Value Proposition */}
        <div>
          <h1 className="text-4xl font-display uppercase leading-[0.98] sm:text-6xl lg:text-[4.2rem]">
            The High-Performance Trading Terminal on Arc.
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-mute sm:text-base">
            One unified, non-custodial execution engine on Arc L1. High-speed spot DEX aggregation across 0x &amp; KyberSwap, smart contract conditional orders in ArcTradeOrders, and an agent parser that compiles natural language into signed transactions.
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

          {/* Hyperliquid-style Live Metric Ribbon */}
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-line/60 pt-5 font-mono text-xs">
            <div className="border border-line bg-panel p-3">
              <span className="block text-[10px] uppercase font-bold text-mute">Block Finality</span>
              <span className="mt-1 block font-display text-lg text-up">&lt; 1s</span>
              <span className="text-[10px] text-mute">Deterministic</span>
            </div>
            <div className="border border-line bg-panel p-3">
              <span className="block text-[10px] uppercase font-bold text-mute">Gas Currency</span>
              <span className="mt-1 block font-display text-lg text-ink">USDC</span>
              <span className="text-[10px] text-mute">Native 18 Decimals</span>
            </div>
            <div className="border border-line bg-panel p-3">
              <span className="block text-[10px] uppercase font-bold text-mute">Order Types</span>
              <span className="mt-1 block font-display text-lg text-ink">6 + DCA</span>
              <span className="text-[10px] text-mute">Smart Escrow</span>
            </div>
            <div className="border border-line bg-panel p-3">
              <span className="block text-[10px] uppercase font-bold text-mute">Custody Risk</span>
              <span className="mt-1 block font-display text-lg text-up">0.00%</span>
              <span className="text-[10px] text-mute">100% Self-Custodial</span>
            </div>
          </div>
        </div>

        {/* Right: Hyperliquid Interactive Terminal Sandbox */}
        <div className="border border-line bg-panel shadow-hard-lg">
          {/* Tab navigation */}
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
                      Select Prompt Scenario:
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
                          {parsed.ok ? `Compiled Intent: ${parsed.intent.kind}` : 'Syntax Warning'}
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
                            <span className="text-mute">Trigger Price:</span>
                            <span className="font-bold text-ink">${parsed.intent.price}</span>
                          </div>
                        )}
                        {'frequency' in parsed.intent && (
                          <div className="flex justify-between py-0.5">
                            <span className="text-mute">Execution Cadence:</span>
                            <span className="font-bold text-ink">
                              {parsed.intent.frequency} ({parsed.intent.days} days)
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between py-0.5">
                          <span className="text-mute">Settlement Asset:</span>
                          <span className="font-bold text-up">Native USDC (Zero wrapping)</span>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 font-mono text-xs text-down">{parsed.error}</p>
                    )}

                    <div className="mt-3 flex items-center justify-between border-t border-line/30 pt-2.5">
                      <span className="font-mono text-[11px] text-mute">
                        Explicit cryptographic wallet signature required
                      </span>
                      <button
                        onClick={handleExecute}
                        className="press border border-line bg-accent px-3 py-1 font-mono text-xs font-bold text-accent-ink shadow-hard-sm hover:opacity-95"
                      >
                        Execute in Agent &gt;
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
                    <span className="text-[11px] text-mute">Chainlink Oracle: 91,420.50</span>
                  </div>

                  {/* Asks (Sells) */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-down/80">
                      <span>91,520.00</span>
                      <span className="num">1.45 cirBTC</span>
                      <div className="w-16 bg-down/20 h-2 self-center rounded-none" />
                    </div>
                    <div className="flex justify-between text-down/80">
                      <span>91,480.00</span>
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
                      <span>91,400.00</span>
                      <span className="num">2.10 cirBTC</span>
                      <div className="w-20 bg-up/20 h-2 self-center rounded-none" />
                    </div>
                    <div className="flex justify-between text-up/90">
                      <span>91,350.00</span>
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
                    <span className="font-bold text-ink">Deterministic Intent Compilation</span>
                    <p className="text-[11px] text-mute mt-0.5">Strict grammar validation. Liquidity quoted. Balance verified.</p>
                  </div>
                  <div className="border-l-2 border-line pl-3 py-1">
                    <span className="text-[10px] font-bold text-mute uppercase block">Stage 2</span>
                    <span className="font-bold text-ink">Cryptographic User Signature</span>
                    <p className="text-[11px] text-mute mt-0.5">Wagmi/Viem sends verified transaction to ArcTradeOrders.</p>
                  </div>
                  <div className="border-l-2 border-line pl-3 py-1">
                    <span className="text-[10px] font-bold text-mute uppercase block">Stage 3</span>
                    <span className="font-bold text-ink">Smart Escrow &amp; Keeper Watch</span>
                    <p className="text-[11px] text-mute mt-0.5">Funds locked in escrow. Autonomous bots monitor Chainlink round data.</p>
                  </div>
                  <div className="border-l-2 border-line pl-3 py-1">
                    <span className="text-[10px] font-bold text-mute uppercase block">Stage 4</span>
                    <span className="font-bold text-up">Deterministic Settlement</span>
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

// ---------- 3. HYPERLIQUID SIGNATURE: INTERACTIVE PROTOCOL STACK ----------

interface StackTier {
  id: string
  num: string
  name: string
  tagline: string
  contractRef: string
  facts: [string, string][]
  summary: string
}

const PROTOCOL_STACK: StackTier[] = [
  {
    id: 'layer-agent',
    num: 'LAYER 04',
    name: 'Agent Compilation & Guardrails',
    tagline: 'Deterministic Natural Language to On-Chain Transaction Compiler',
    contractRef: 'src/trading/agent/parser.ts',
    summary: 'Converts conversational trading intentions into verified contract payloads without probabilistic hallucination risks.',
    facts: [
      ['Grammar Engine', 'Deterministic client-side AST compiler'],
      ['Key Custody', 'Zero server access · 100% wallet signed'],
      ['Risk Controls', 'Daily budget caps & pre-execution simulation'],
    ],
  },
  {
    id: 'layer-gateway',
    num: 'LAYER 03',
    name: 'Liquidity Gateway & Aggregation',
    tagline: 'Parallel Liquidity Discovery across 0x & KyberSwap v2',
    contractRef: '0x000...22734 / 0x613...37b5',
    summary: 'Simultaneously quotes 0x AllowanceHolder and KyberSwap v2, optimizing for maximum received tokens net of gas.',
    facts: [
      ['Mainnet Routers', '0x Cancun AllowanceHolder + KyberSwap v2'],
      ['Simulation', 'On-chain eth_call pre-trade validation'],
      ['Slippage Floor', 'Guaranteed minimum received output'],
    ],
  },
  {
    id: 'layer-escrow',
    num: 'LAYER 02',
    name: 'Conditional Escrow & Keeper Core',
    tagline: 'On-Chain Execution Engine with Decentralized Keepers',
    contractRef: 'ArcTradeOrders.sol v2 (23,778 B)',
    summary: 'Escrows limit, stop, trailing, and DCA orders on Arc L1. Permissionless keeper bots trigger executions on oracle cross.',
    facts: [
      ['Order Matrix', 'Limit, Stop-Loss, Take-Profit, Trailing, OCO, DCA'],
      ['Keeper Bounty', '0.10% output fee (strictly lower-only)'],
      ['Cancellation', 'Instant 100% principal return at any block'],
    ],
  },
  {
    id: 'layer-l1',
    num: 'LAYER 01',
    name: 'Arc L1 Consensus & Native Settlement',
    tagline: 'Deterministic Sub-Second Finality with Native USDC Gas',
    contractRef: 'Arc L1 (Chain 5042 / 5042002)',
    summary: 'The underlying blockchain foundation engineered for financial throughput without predatory MEV sandwich attacks.',
    facts: [
      ['Gas Economy', 'Native 18-dec USDC unified with 6-dec balances'],
      ['Finality', 'Deterministic sub-second single block finality'],
      ['Data Feeds', 'Chainlink oracles with round completeness checks'],
    ],
  },
]

function InteractiveProtocolStack() {
  const [activeTierId, setActiveTierId] = useState<string>('layer-escrow')
  const activeTier = PROTOCOL_STACK.find((t) => t.id === activeTierId) ?? PROTOCOL_STACK[2]
  const { animate } = useSettings()

  return (
    <section>
      <SectionHeader
        kicker="Protocol Architecture"
        title="Infrastructure to house all finance on Arc."
        desc="Interactive multi-tier architecture breaking down how execution, escrow, aggregation, and natural-language compilation stack together."
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Tier Selector Stack */}
        <div className="space-y-3">
          {PROTOCOL_STACK.map((tier) => {
            const isSelected = tier.id === activeTierId
            return (
              <button
                key={tier.id}
                onClick={() => setActiveTierId(tier.id)}
                className={clsx(
                  'w-full text-left border border-line p-4 sm:p-5 transition-all duration-150',
                  isSelected
                    ? 'bg-ink text-canvas shadow-hard -translate-y-0.5'
                    : 'bg-panel text-ink hover:bg-raised shadow-hard-sm',
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={clsx(
                      'font-mono text-xs font-bold px-2 py-0.5',
                      isSelected ? 'bg-accent text-accent-ink' : 'bg-raised text-mute',
                    )}
                  >
                    {tier.num}
                  </span>
                  <span className="font-mono text-[11px] opacity-70">
                    {tier.contractRef}
                  </span>
                </div>
                <h3 className="mt-2 text-lg sm:text-xl font-display uppercase tracking-tight">
                  {tier.name}
                </h3>
                <p className={clsx('mt-1 text-xs sm:text-sm font-mono', isSelected ? 'text-canvas/80' : 'text-mute')}>
                  {tier.tagline}
                </p>
              </button>
            )
          })}
        </div>

        {/* Selected Tier Deep-Dive Spec Card */}
        <div className="border border-line bg-panel p-6 shadow-hard flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-line pb-3">
              <span className="bg-accent text-accent-ink font-mono text-xs font-bold px-2 py-0.5 uppercase">
                {activeTier.num} SPECIFICATION
              </span>
              <span className="font-mono text-xs font-bold text-ink">
                {activeTier.contractRef}
              </span>
            </div>

            <h3 className="mt-4 text-2xl font-display uppercase text-ink">
              {activeTier.name}
            </h3>
            <p className="mt-2 text-xs sm:text-sm text-mute leading-relaxed">
              {activeTier.summary}
            </p>

            <div className="mt-6 border-t border-line/40 pt-4 space-y-2.5">
              <span className="block font-mono text-[11px] font-bold uppercase text-mute">
                Architectural Guarantees:
              </span>
              {activeTier.facts.map(([k, v]) => (
                <div key={k} className="border border-line bg-raised p-3 font-mono text-xs">
                  <span className="block text-[10px] uppercase font-bold text-mute">{k}</span>
                  <span className="mt-0.5 block font-bold text-ink">{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 border-t border-line/40 pt-4 flex items-center justify-between font-mono text-xs">
            <span className="text-mute">Status: Audited &amp; Deployed</span>
            <span className="text-up font-bold">100% Non-Custodial</span>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------- 4. FINANCIAL PRIMITIVES (HYPERLIQUID BENTO CARDS) ----------

interface FeatureModule {
  code: string
  title: string
  tag: string
  desc: string
  specs: [string, string][]
  targetPage: 'trade' | 'agent'
}

const FEATURE_MODULES: FeatureModule[] = [
  {
    code: 'MOD-01',
    title: 'Spot DEX Aggregator',
    tag: 'Best Output Routing',
    desc: 'Parallel quoting engine querying 0x AllowanceHolder and KyberSwap v2. Evaluates net tokens minus gas with instant on-chain simulation.',
    specs: [
      ['Routing', '0x Cancun + KyberSwap v2'],
      ['Slippage floor', 'Configurable 0.1% to 5.0%'],
      ['Routable pairs', '60+ verified tokens on Arc'],
    ],
    targetPage: 'trade',
  },
  {
    code: 'MOD-02',
    title: 'Smart Order Escrow',
    tag: 'Limit · Stops · OCO',
    desc: 'Limit, Stop-Loss, Take-Profit, Stop-Limit, Trailing-Stop, and OCO. Funds are escrowed in ArcTradeOrders.sol and filled automatically by decentralized keepers.',
    specs: [
      ['Contract', 'ArcTradeOrders v2 (23,778 B)'],
      ['Keeper trigger', 'Chainlink round verification'],
      ['Cancellation', 'Instant 100% refund anytime'],
    ],
    targetPage: 'trade',
  },
  {
    code: 'MOD-03',
    title: 'Automated DCA Engine',
    tag: 'Recurring Purchases',
    desc: 'Automate dollar-cost averaging on Arc. Configure hourly, daily, weekly, or monthly execution with maximum price ceiling caps to prevent buying during spikes.',
    specs: [
      ['Cadence', 'Hourly, Daily, Weekly, Monthly'],
      ['Ceiling protection', 'Optional price barrier guard'],
      ['Principal exit', 'Refund unspent budget anytime'],
    ],
    targetPage: 'trade',
  },
]

function FinancialPrimitivesGrid({ onNavigate }: { onNavigate: (page: 'trade' | 'agent') => void }) {
  return (
    <section>
      <SectionHeader
        kicker="Core Primitives"
        title="Engineered for high-frequency on-chain control."
        desc="All execution modules run directly on Arc blockchain infrastructure with zero counterparty custodial risk."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {FEATURE_MODULES.map((mod) => (
          <Reveal key={mod.code}>
            <div className="group flex h-full flex-col justify-between border border-line bg-panel p-5 shadow-hard-sm hover:border-line hover:shadow-hard transition-all duration-150">
              <div>
                <div className="flex items-center justify-between border-b border-line pb-2.5">
                  <span className="font-mono text-xs font-bold text-mute">{mod.code}</span>
                  <span className="border border-line bg-raised px-1.5 py-0.5 font-mono text-[10px] font-bold text-ink">
                    {mod.tag}
                  </span>
                </div>
                <h3 className="mt-3 font-display text-lg font-bold uppercase tracking-tight text-ink">
                  {mod.title}
                </h3>
                <p className="mt-2 text-xs sm:text-sm text-mute leading-relaxed">{mod.desc}</p>
              </div>

              <div className="mt-4 border-t border-line/40 pt-3">
                <div className="space-y-1 font-mono text-[11px]">
                  {mod.specs.map(([k, v]) => (
                    <div key={k} className="flex justify-between text-mute">
                      <span>{k}:</span>
                      <span className="font-bold text-ink">{v}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => onNavigate(mod.targetPage)}
                  className="press mt-4 flex w-full items-center justify-center gap-1.5 border border-line bg-raised py-2 font-mono text-xs font-bold text-ink group-hover:bg-accent group-hover:text-accent-ink transition-colors"
                >
                  <span>Launch Primitive</span>
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

// ---------- 5. ARC L1 TECHNICAL COMPARISON MATRIX ----------

interface ComparisonRow {
  aspect: string
  arcStandard: string
  legacyStandard: string
}

const COMPARISON_ROWS: ComparisonRow[] = [
  {
    aspect: 'Gas Currency',
    arcStandard: 'Native USDC (18-dec) unified with 6-dec balances. No wrapping needed.',
    legacyStandard: 'Synthetic WETH/wrapped tokens requiring manual wrapping transactions.',
  },
  {
    aspect: 'Block Finality',
    arcStandard: 'Sub-second deterministic single-block finality.',
    legacyStandard: 'Probabilistic finality subject to MEV reorgs and block reordering.',
  },
  {
    aspect: 'Oracle Validation',
    arcStandard: 'Chainlink round validation checking answeredInRound >= roundId on-chain.',
    legacyStandard: 'Unchecked oracle staleness vulnerable to Flash Loan price manipulation.',
  },
  {
    aspect: 'Keeper Decentralization',
    arcStandard: 'Permissionless keeper execution with hardcoded 0.10% lower-only fee cap.',
    legacyStandard: 'Centralized relayer networks with arbitrary execution markups.',
  },
]

function TechnicalComparisonMatrix() {
  return (
    <section>
      <SectionHeader
        kicker="Technical Blueprint"
        title="Why Lumarc is built natively on Arc L1."
        desc="Arc network provides the architectural primitives required for institutional-grade non-custodial trading."
      />

      <div className="border border-line bg-panel shadow-hard overflow-x-auto">
        <table className="w-full text-left border-collapse font-mono text-xs">
          <thead>
            <tr className="border-b border-line bg-ink text-canvas">
              <th className="p-3.5 sm:p-4 font-bold uppercase w-1/4">Architectural Primitive</th>
              <th className="p-3.5 sm:p-4 font-bold uppercase w-3/8 text-accent">Arc L1 Standard (Lumarc)</th>
              <th className="p-3.5 sm:p-4 font-bold uppercase w-3/8 opacity-70">Legacy EVM DEX Models</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {COMPARISON_ROWS.map((row) => (
              <tr key={row.aspect} className="hover:bg-raised/60 transition-colors">
                <td className="p-3.5 sm:p-4 font-bold text-ink">{row.aspect}</td>
                <td className="p-3.5 sm:p-4 font-bold text-ink bg-accent/5">{row.arcStandard}</td>
                <td className="p-3.5 sm:p-4 text-mute">{row.legacyStandard}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ---------- 6. CLIENT SOVEREIGNTY & SECURITY LEDGER ----------

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
                <strong>Mandatory Cryptographic Signing:</strong> Every single trade, allowance approval, and order registration requires direct cryptographic signature.
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

// ---------- 7. LAUNCH BANNER (HYPERLIQUID STYLE) ----------

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
    <div className="w-full space-y-14 sm:space-y-24 pb-12">
      <MarketTickerStrip />
      <HeroTerminal onTrade={() => setPage('trade')} onAgent={() => setPage('agent')} />
      <InteractiveProtocolStack />
      <FinancialPrimitivesGrid onNavigate={(target) => setPage(target)} />
      <TechnicalComparisonMatrix />
      <SecurityProtocol />
      <LaunchTerminalBanner onTrade={() => setPage('trade')} onAgent={() => setPage('agent')} />
    </div>
  )
}
