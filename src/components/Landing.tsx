import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { clsx } from 'clsx'
import {
  ArrowUpRight,
  Check,
  Copy,
  Terminal as TerminalIcon,
  Activity,
  Layers,
  Shield,
  Cpu,
  RefreshCw,
  ExternalLink,
  ChevronRight,
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

// ---------- 1. HYPERLIQUID INSTITUTIONAL PARTNER TICKER STRIP ----------

const ECOSYSTEM_PARTNERS = [
  'ARC L1 NETWORK',
  'CIRCLE USDC',
  '0x PROTOCOL',
  'KYBERSWAP V2',
  'CHAINLINK FEEDS',
  'FOUNDRY V1.7.1',
  'VIEM & WAGMI',
  'TESTNET HARNESS 5042002',
]

function InstitutionalPartnerStrip() {
  return (
    <div className="w-full border-y border-line/60 bg-panel/60 py-3 overflow-hidden">
      <div className="flex items-center justify-between gap-6 whitespace-nowrap font-mono text-xs font-bold text-mute tracking-widest uppercase">
        {ECOSYSTEM_PARTNERS.map((partner) => (
          <div key={partner} className="flex items-center gap-3 shrink-0 px-4">
            <span className="h-1.5 w-1.5 bg-line/40" aria-hidden="true" />
            <span className="hover:text-ink transition-colors">{partner}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- 2. ANIMATED PARTICLE WAVE CANVAS (HYPERLIQUID SIGNATURE) ----------

function HyperliquidParticleWave() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    let width = (canvas.width = canvas.parentElement?.clientWidth || 1200)
    let height = (canvas.height = 360)

    const handleResize = () => {
      if (!canvas.parentElement) return
      width = canvas.width = canvas.parentElement.clientWidth
      height = canvas.height = 360
    }
    window.addEventListener('resize', handleResize)

    // Particles representing order nodes and keepers
    const numParticles = 65
    const particles = Array.from({ length: numParticles }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      radius: Math.random() * 2.2 + 1.2,
      baseAlpha: Math.random() * 0.4 + 0.35,
    }))

    const render = () => {
      ctx.clearRect(0, 0, width, height)

      // Background subtle gradient
      const bgGrad = ctx.createLinearGradient(0, 0, width, height)
      bgGrad.addColorStop(0, '#0c1a16')
      bgGrad.addColorStop(0.5, '#081210')
      bgGrad.addColorStop(1, '#050b0a')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, width, height)

      // Draw grid line mesh
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.04)'
      ctx.lineWidth = 1
      const gridSize = 40
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }

      // Update and draw particles
      for (let i = 0; i < numParticles; i++) {
        const p = particles[i]
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0) p.x = width
        if (p.x > width) p.x = 0
        if (p.y < 0) p.y = height
        if (p.y > height) p.y = 0

        // Particle circle
        ctx.fillStyle = `rgba(74, 222, 128, ${p.baseAlpha})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
        ctx.fill()

        // Connecting lines to nearby particles
        for (let j = i + 1; j < numParticles; j++) {
          const p2 = particles[j]
          const dx = p.x - p2.x
          const dy = p.y - p2.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 85) {
            ctx.strokeStyle = `rgba(74, 222, 128, ${(1 - dist / 85) * 0.16})`
            ctx.beginPath()
            ctx.moveTo(p.x, p.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.stroke()
          }
        }
      }

      animId = requestAnimationFrame(render)
    }

    render()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return (
    <div className="relative w-full overflow-hidden border border-line shadow-hard-lg">
      <canvas ref={canvasRef} className="block w-full h-[360px]" />
      <div className="absolute top-4 left-4 inline-flex items-center gap-2 border border-line bg-ink/90 px-3 py-1 font-mono text-xs font-bold text-accent">
        <span className="h-2 w-2 bg-up animate-pulse" />
        <span>ARC L1 CONSENSUS // DECENTRALIZED KEEPER NETWORK</span>
      </div>
      <div className="absolute bottom-4 right-4 hidden sm:block font-mono text-[11px] text-canvas/70 bg-ink/80 px-2.5 py-1 border border-line">
        Sub-Second Deterministic Block Time · 0x &amp; KyberSwap Quoting Gateway
      </div>
    </div>
  )
}

// ---------- 3. HERO SECTION (HYPERLIQUID EDITORIAL LAYOUT) ----------

interface PresetOption {
  label: string
  cmd: string
  intent: string
  outcome: string
}

const PRESET_OPTIONS: PresetOption[] = [
  {
    label: 'Market Swap',
    cmd: 'buy 250 USDC of cirBTC',
    intent: 'Aggregator Spot Swap',
    outcome: 'Parallel 0x & KyberSwap v2 route evaluation with guaranteed output.',
  },
  {
    label: 'Limit Order',
    cmd: 'limit buy cirBTC 100 USDC at 88500',
    intent: 'Escrowed Limit Order',
    outcome: 'Assets escrowed in ArcTradeOrders.sol. Keepers fill on oracle cross.',
  },
  {
    label: 'Stop Loss',
    cmd: 'stop loss 0.2 cirBTC at 86000',
    intent: 'Chainlink Stop Trigger',
    outcome: 'Automated capital protection monitoring Chainlink feeds 24/7.',
  },
  {
    label: 'DCA Accumulation',
    cmd: 'dca 20 USDC into WETH daily for 14 days',
    intent: 'Scheduled DCA Cadence',
    outcome: 'Automated recurring execution. Unspent budget refundable at any block.',
  },
]

function Hero({ onTrade, onAgent }: { onTrade: () => void; onAgent: () => void }) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [inputVal, setInputVal] = useState(PRESET_OPTIONS[0].cmd)
  const [copied, setCopied] = useState(false)
  const { animate } = useSettings()

  const currentPreset = PRESET_OPTIONS[selectedIdx]
  const parsed = useMemo(() => parseCommand(inputVal), [inputVal])

  const handleSelectPreset = (idx: number) => {
    setSelectedIdx(idx)
    setInputVal(PRESET_OPTIONS[idx].cmd)
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
    <section className="pt-2 sm:pt-6 space-y-8">
      {/* Hyperliquid Editorial Two-Column Headline */}
      <div className="grid items-end gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:gap-12">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 border border-line bg-panel px-3 py-1 font-mono text-xs font-bold text-ink">
            <span className="h-2 w-2 bg-up" aria-hidden="true" />
            <span>BUILT ON ARC BLOCKCHAIN</span>
          </div>
          <h1 className="text-4xl font-display uppercase leading-[0.96] sm:text-6xl lg:text-[4.6rem] tracking-tight">
            Infrastructure to House All Trading.
          </h1>
        </div>

        <div className="space-y-5">
          <p className="text-base sm:text-lg text-mute leading-relaxed font-sans font-medium">
            Spot aggregation, on-chain conditional orders, and DCA. Open 24/7 on Arc L1 with a deterministic agent compiler, without centralized intermediaries.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onTrade}
              className="press inline-flex min-h-[50px] items-center gap-2 border border-line bg-accent px-6 text-sm font-bold text-accent-ink shadow-hard hover:opacity-95"
            >
              <span>TRADE NOW</span>
              <ArrowUpRight className="h-4 w-4" />
            </button>
            <button
              onClick={onAgent}
              className="press inline-flex min-h-[50px] items-center gap-2 border border-line bg-panel px-6 text-sm font-bold text-ink shadow-hard-sm hover:bg-raised"
            >
              <TerminalIcon className="h-4 w-4 text-ink" />
              <span>AGENT PROMPTS</span>
            </button>
          </div>
        </div>
      </div>

      {/* Institutional Partner Ticker */}
      <InstitutionalPartnerStrip />

      {/* Signature Animated Wave Field */}
      <HyperliquidParticleWave />

      {/* Hyperliquid 4-Column Live Metric Ribbon */}
      <div className="grid grid-cols-2 divide-y divide-line border border-line bg-panel sm:grid-cols-4 sm:divide-y-0 sm:divide-x shadow-hard-sm">
        <div className="p-4 sm:p-5">
          <span className="font-mono text-[10px] sm:text-[11px] font-bold uppercase text-mute block">
            Block Finality
          </span>
          <span className="mt-1 block font-display text-2xl sm:text-3xl text-up">&lt; 1s</span>
          <span className="font-mono text-[11px] text-mute">Deterministic L1 Block</span>
        </div>
        <div className="p-4 sm:p-5">
          <span className="font-mono text-[10px] sm:text-[11px] font-bold uppercase text-mute block">
            Gas Currency
          </span>
          <span className="mt-1 block font-display text-2xl sm:text-3xl text-ink">USDC</span>
          <span className="font-mono text-[11px] text-mute">Native 18 Decimals</span>
        </div>
        <div className="p-4 sm:p-5 border-t sm:border-t-0">
          <span className="font-mono text-[10px] sm:text-[11px] font-bold uppercase text-mute block">
            Order Engine
          </span>
          <span className="mt-1 block font-display text-2xl sm:text-3xl text-ink">6 + DCA</span>
          <span className="font-mono text-[11px] text-mute">On-Chain Smart Escrow</span>
        </div>
        <div className="p-4 sm:p-5 border-t sm:border-t-0">
          <span className="font-mono text-[10px] sm:text-[11px] font-bold uppercase text-mute block">
            Custody Risk
          </span>
          <span className="mt-1 block font-display text-2xl sm:text-3xl text-up">0.00%</span>
          <span className="font-mono text-[11px] text-mute">100% Self-Custodial</span>
        </div>
      </div>
    </section>
  )
}

// ---------- 4. FLAGSHIP APP & TERMINAL SHOWCASE (HYPERLIQUID STYLE) ----------

interface ShowcaseAsset {
  pair: string
  price: string
  change: string
  isUp: boolean
}

const SHOWCASE_ASSETS: ShowcaseAsset[] = [
  { pair: 'cirBTC/USDC', price: '91,420.50', change: '+3.12%', isUp: true },
  { pair: 'WETH/USDC', price: '3,210.80', change: '+1.85%', isUp: true },
  { pair: 'ARC/USDC', price: '1.45', change: '+6.20%', isUp: true },
  { pair: 'EURC/USDC', price: '1.053', change: '-0.12%', isUp: false },
]

function FlagshipAppShowcase({ onTrade, onAgent }: { onTrade: () => void; onAgent: () => void }) {
  const [selectedAsset, setSelectedAsset] = useState<string>('cirBTC/USDC')
  const [activeConsoleTab, setActiveConsoleTab] = useState<'prompt' | 'depth'>('prompt')
  const [promptText, setPromptText] = useState('buy 250 USDC of cirBTC')
  const { animate } = useSettings()

  const parsed = useMemo(() => parseCommand(promptText), [promptText])

  return (
    <section>
      <SectionHeader
        kicker="Terminal Engine"
        title="Trade everything in one place."
        desc="cirBTC, WETH, ARC, EURC, and more, on non-custodial markets that never close."
      />

      <div className="border border-line bg-panel shadow-hard">
        {/* Top Asset Pill Bar (Exact Hyperliquid Style) */}
        <div className="flex items-center justify-between border-b border-line bg-raised px-4 py-3 overflow-x-auto">
          <div className="flex items-center gap-2">
            {SHOWCASE_ASSETS.map((asset) => {
              const isSelected = selectedAsset === asset.pair
              return (
                <button
                  key={asset.pair}
                  onClick={() => {
                    setSelectedAsset(asset.pair)
                    setPromptText(`buy 250 USDC of ${asset.pair.split('/')[0]}`)
                  }}
                  className={clsx(
                    'flex items-center gap-2 border border-line px-3 py-1 font-mono text-xs font-bold transition-all',
                    isSelected
                      ? 'bg-ink text-canvas shadow-hard-sm'
                      : 'bg-panel text-ink hover:bg-panel2',
                  )}
                >
                  <span>{asset.pair}</span>
                  <span className={clsx(asset.isUp ? 'text-up' : 'text-down')}>
                    ${asset.price}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="hidden sm:flex items-center gap-2">
            <button
              onClick={onTrade}
              className="press inline-flex items-center gap-1.5 border border-line bg-accent px-3 py-1 font-mono text-xs font-bold text-accent-ink"
            >
              <span>Launch Terminal</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Embedded Terminal & Depth Console */}
        <div className="grid lg:grid-cols-[1.1fr_0.9fr] divide-y lg:divide-y-0 lg:divide-x divide-line">
          {/* Left: Terminal Trading Ladder & Chart Visual */}
          <div className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <span className="font-display text-lg uppercase text-ink">{selectedAsset}</span>
                <span className="border border-line bg-up/10 px-2 py-0.5 font-mono text-xs font-bold text-up">
                  LIVE L1
                </span>
              </div>
              <span className="font-mono text-xs text-mute">
                Oracle Source: Chainlink Arc
              </span>
            </div>

            {/* Depth Ladder */}
            <div className="space-y-2 font-mono text-xs">
              <div className="text-[11px] uppercase font-bold text-mute flex justify-between">
                <span>Price (USDC)</span>
                <span>Size</span>
                <span>Depth</span>
              </div>

              {/* Asks */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-down">
                  <span className="num font-bold">91,520.00</span>
                  <span className="num text-ink">1.450</span>
                  <div className="w-24 bg-down/20 h-2" />
                </div>
                <div className="flex items-center justify-between text-down">
                  <span className="num font-bold">91,480.00</span>
                  <span className="num text-ink">0.820</span>
                  <div className="w-14 bg-down/20 h-2" />
                </div>
              </div>

              {/* Spread marker */}
              <div className="border-y border-line/50 py-1.5 text-center font-bold text-ink bg-raised">
                Mid Market Spread: 0.04% // 0x &amp; KyberSwap Quoted
              </div>

              {/* Bids */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-up">
                  <span className="num font-bold">91,400.00</span>
                  <span className="num text-ink">2.100</span>
                  <div className="w-28 bg-up/20 h-2" />
                </div>
                <div className="flex items-center justify-between text-up">
                  <span className="num font-bold">91,350.00</span>
                  <span className="num text-ink">3.500</span>
                  <div className="w-40 bg-up/20 h-2" />
                </div>
              </div>
            </div>

            <p className="text-[11px] font-mono text-mute pt-2 border-t border-line/40">
              Orders remain in ArcTradeOrders escrow until keepers invoke fill transactions upon oracle trigger crossing.
            </p>
          </div>

          {/* Right: Interactive Prompt Compiler Console */}
          <div className="p-5 sm:p-6 space-y-4 bg-raised/40">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2 font-mono text-xs font-bold text-ink uppercase">
                <TerminalIcon className="h-4 w-4 text-accent" />
                <span>Agent Prompt Sandbox</span>
              </div>
              <span className="font-mono text-[10px] text-mute uppercase">
                Deterministic Grammar
              </span>
            </div>

            {/* Prompt input */}
            <div className="border border-line bg-ink p-3 text-canvas font-mono text-xs sm:text-sm">
              <div className="flex items-center gap-2">
                <span className="font-bold text-accent">&gt;</span>
                <input
                  type="text"
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  className="w-full bg-transparent text-canvas outline-none"
                  placeholder="Type trading instruction..."
                />
              </div>
            </div>

            {/* Dynamic Syntax Output */}
            <div className="border border-line bg-panel p-3 font-mono text-xs space-y-2">
              <div className="flex justify-between border-b border-line/40 pb-1.5">
                <span className="text-mute">Compiled Intent:</span>
                <span className="font-bold text-ink uppercase">
                  {parsed.ok ? parsed.intent.kind : 'Syntax Error'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-mute">Gas Asset:</span>
                <span className="font-bold text-up">Native USDC (No wrapping)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-mute">Safety Gate:</span>
                <span className="font-bold text-ink">Verified Balance &amp; Slippage</span>
              </div>
            </div>

            <button
              onClick={() => {
                setAgentPrefill(promptText)
                onAgent()
              }}
              className="press w-full flex items-center justify-center gap-2 border border-line bg-accent py-2.5 font-mono text-xs font-bold text-accent-ink shadow-hard-sm hover:opacity-95"
            >
              <span>Execute Intent in Agent Station</span>
              <ArrowUpRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------- 5. HYPERLIQUID SIGNATURE: DARK MANIFESTO (01, 02, 03) ----------

function DarkManifestoSection() {
  return (
    <section>
      <div className="border border-line bg-ink p-8 text-canvas shadow-hard-lg sm:p-12 lg:p-16 space-y-12">
        <div className="flex items-center justify-between border-b border-line/40 pb-4">
          <span className="bg-accent text-accent-ink font-mono text-xs font-bold px-2 py-0.5 uppercase">
            PROTOCOL MANIFESTO
          </span>
          <span className="font-mono text-xs text-canvas/70">
            THE NON-CUSTODIAL THESIS ON ARC
          </span>
        </div>

        <div className="space-y-10 max-w-4xl">
          {/* 01 */}
          <div className="grid gap-4 sm:grid-cols-[60px_1fr] items-start">
            <span className="font-mono text-2xl font-bold text-accent">01</span>
            <div>
              <h3 className="font-display text-2xl sm:text-3xl lg:text-4xl uppercase leading-tight text-canvas">
                Lumarc vision is to house all trading on Arc in one open, transparent, credibly neutral terminal.
              </h3>
            </div>
          </div>

          {/* 02 */}
          <div className="grid gap-4 sm:grid-cols-[60px_1fr] items-start border-t border-line/30 pt-8">
            <span className="font-mono text-2xl font-bold text-accent">02</span>
            <div>
              <h3 className="font-display text-2xl sm:text-3xl lg:text-4xl uppercase leading-tight text-canvas/90">
                The legacy financial system was built around centralized custodians that hold funds, gatekeep access, and extract the value users create.
              </h3>
            </div>
          </div>

          {/* 03 */}
          <div className="grid gap-4 sm:grid-cols-[60px_1fr] items-start border-t border-line/30 pt-8">
            <span className="font-mono text-2xl font-bold text-accent">03</span>
            <div>
              <h3 className="font-display text-2xl sm:text-3xl lg:text-4xl uppercase leading-tight text-canvas">
                On Arc, trading is sovereign: funds never leave your wallet, conditional orders live in audited smart contracts, and keepers execute permissionlessly.
              </h3>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------- 6. PROTOCOL ARCHITECTURE & APPS TABLE (HYPERLIQUID ECOSYSTEM) ----------

interface AppItem {
  name: string
  subtext: string
  tag: string
  route: string
}

const ECOSYSTEM_APPS: AppItem[] = [
  { name: 'Spot DEX Aggregator', subtext: '0x Cancun AllowanceHolder & KyberSwap v2 Router', tag: 'Live L1', route: 'trade' },
  { name: 'Conditional Order Escrow', subtext: 'ArcTradeOrders.sol v2 (Limit, Stops, Trailing, OCO)', tag: 'On-Chain', route: 'trade' },
  { name: 'Automated DCA Engine', subtext: 'Interval-based recurring purchases with ceiling price caps', tag: 'Automated', route: 'trade' },
  { name: 'Autonomous Agent Station', subtext: 'Deterministic natural language intent compiler with budget gates', tag: 'Agentic', route: 'agent' },
  { name: 'Portfolio Analytics', subtext: 'Real-time asset balance tracking & active conditional order monitor', tag: 'Dashboard', route: 'dashboard' },
]

function EcosystemAppsTable({ onNavigate }: { onNavigate: (page: string) => void }) {
  return (
    <section>
      <SectionHeader
        kicker="Ecosystem Apps"
        title="Modules built for high-throughput execution."
        desc="Explore the suite of non-custodial decentralized financial tools operating on Arc."
      />

      <div className="border border-line bg-panel shadow-hard divide-y divide-line">
        {ECOSYSTEM_APPS.map((app) => (
          <div
            key={app.name}
            onClick={() => onNavigate(app.route)}
            className="group flex cursor-pointer items-center justify-between p-4 sm:p-5 hover:bg-raised transition-colors"
          >
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-base sm:text-lg uppercase text-ink group-hover:text-accent-ink transition-colors">
                  {app.name}
                </h3>
                <span className="border border-line bg-panel px-1.5 py-0.2 font-mono text-[10px] font-bold text-mute">
                  {app.tag}
                </span>
              </div>
              <p className="mt-1 font-mono text-xs text-mute">{app.subtext}</p>
            </div>

            <div className="flex items-center gap-2 font-mono text-xs font-bold text-ink group-hover:translate-x-1 transition-transform">
              <span className="hidden sm:inline">Launch</span>
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---------- 7. BUILDER CODES & DEVELOPER SECTION ----------

function BuilderCodesSection() {
  return (
    <section>
      <div className="border border-line bg-panel p-6 sm:p-8 shadow-hard">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <span className="font-mono text-xs font-bold uppercase text-mute">
            BUILDER INFRASTRUCTURE // INTEGRATE LUMARC
          </span>
          <span className="font-mono text-xs text-mute">
            Solidity &amp; TypeScript SDK
          </span>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr] items-center">
          <div>
            <h3 className="text-2xl sm:text-3xl font-display uppercase text-ink">
              Integrate Arc Trading &amp; Escrow
            </h3>
            <p className="mt-3 text-xs sm:text-sm text-mute leading-relaxed font-mono">
              Build custom frontends, trading algorithms, or keeper bots. Tap into ArcTradeOrders escrow directly and charge custom platform fees on market swaps without developing backend order matching infrastructure.
            </p>

            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href={BRAND.links.docs}
                target="_blank"
                rel="noopener noreferrer"
                className="press inline-flex min-h-[44px] items-center gap-2 border border-line bg-ink px-5 text-xs sm:text-sm font-bold text-canvas shadow-hard-sm hover:opacity-90"
              >
                <span>READ DEVELOPER DOCS</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <a
                href={BRAND.links.github}
                target="_blank"
                rel="noopener noreferrer"
                className="press inline-flex min-h-[44px] items-center gap-2 border border-line bg-panel px-5 text-xs sm:text-sm font-bold text-ink shadow-hard-sm hover:bg-raised"
              >
                <span>GITHUB REPOSITORY</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          <div className="border border-line bg-ink p-4 font-mono text-xs text-canvas space-y-2">
            <span className="text-mute block text-[10px] uppercase">// CONTRACT ARCHITECTURE</span>
            <div className="text-accent">ArcTradeOrders.sol (23,778 B)</div>
            <div className="text-canvas/80">Functions: createOrder, executeOrder, dcaPlan</div>
            <div className="text-canvas/80">Fee Model: 0.10% Keeper Cap (Lower-Only)</div>
            <div className="text-up">Audit State: Verified Open Execution</div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------- 8. LAUNCH TERMINAL BANNER (HYPERLIQUID STYLE) ----------

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
    <div className="w-full space-y-16 sm:space-y-28 pb-16">
      <Hero onTrade={() => setPage('trade')} onAgent={() => setPage('agent')} />
      <FlagshipAppShowcase onTrade={() => setPage('trade')} onAgent={() => setPage('agent')} />
      <DarkManifestoSection />
      <EcosystemAppsTable onNavigate={(page) => setPage(page as any)} />
      <BuilderCodesSection />
      <LaunchTerminalBanner onTrade={() => setPage('trade')} onAgent={() => setPage('agent')} />
    </div>
  )
}
