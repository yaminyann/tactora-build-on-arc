import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUp, Check, ExternalLink, Loader2, Pencil, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { formatUnits } from 'viem'
import { clsx } from 'clsx'
import { BRAND } from '@/brand'
import { buildTxExplorerUrl } from '@/onchain-facts'
import type { NetworkConfig } from '@/trading/networks'
import { useTokenList } from '@/trading/tokens'
import { useBackendHealth, useNowSeconds } from '@/trading/hooks'
import { useAccountSummary } from '@/trading/account'
import { DcaStatus, OrderType, Side, Status } from '@/trading/types'
import { useSettings } from '@/trading/settings'
import { parseOnchainError } from '@/trading/tx'
import { parseCommand, type Intent } from '@/trading/agent/parser'
import { describeIntent } from '@/trading/agent/summary'
import { takeAgentPrefill } from '@/trading/agent/prefill'
import { canonicalizeIntent, interpretChat, type ChatContext, type Suggestion } from '@/trading/agent/chat'
import { askAgentModel } from '@/trading/agent/llm'
import { useAgentEngine, type Answer, type Plan, type RunResult } from '@/trading/agent/engine'
import {
  addSpent,
  DEFAULT_AGENT,
  DURATIONS,
  gateCommand,
  isGrantActive,
  loadSpentToday,
  SCOPE_LABEL,
  type AgentMode,
  type AgentPermission,
  type AgentScope,
} from '@/trading/agent-permission'
import { Badge, Button, Field, Panel, Segmented, Switch } from './ui'

type ConfirmState = 'waiting' | 'running' | 'done' | 'failed' | 'cancelled'

type Msg =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'agent'; kind: 'text'; text: string; lines?: [string, string][]; linesTitle?: string; tone?: 'error'; suggestions?: Suggestion[] }
  | { id: number; role: 'agent'; kind: 'confirm'; intent: Intent; command: string; plan: Plan; state: ConfirmState; auto: boolean; progress?: string; result?: RunResult; error?: string; note?: string }
  | { id: number; role: 'agent'; kind: 'grant'; pending: string | null; open: boolean }

/** A message before it gets its id. Distributes over the union so each variant keeps its own fields. */
type NewMsg = Msg extends infer M ? (M extends { id: number } ? Omit<M, 'id'> : never) : never

const YES = /^(y|yes|yep|yeah|confirm|confirmed|ok|okay|do it|go|go ahead|haan|ha)$/i
const NO = /^(n|no|nope|cancel|stop|abort|na|nah)$/i
const STALE_MS = 60_000

/** One-time permission form. It never touches keys: the wallet still signs every transaction. */
function GrantForm({ initial, onGrant }: { initial: AgentPermission; onGrant: (p: AgentPermission) => void }) {
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]['id']>('24h')
  const [mode, setMode] = useState<AgentMode>(initial.mode)
  const [maxCmd, setMaxCmd] = useState(String(initial.maxPerCommand))
  const [daily, setDaily] = useState(String(initial.dailyLimit))
  const [scopes, setScopes] = useState(initial.scopes)
  const maxN = Number(maxCmd)
  const dayN = Number(daily)
  const valid = Number.isFinite(maxN) && maxN > 0 && Number.isFinite(dayN) && dayN >= maxN

  const grant = () => {
    const d = DURATIONS.find((x) => x.id === duration)!
    const now = Date.now()
    // "This tab only" is kept as a short grant that the page also drops when it closes.
    const expiresAt = d.ms === 0 ? null : d.ms === -1 ? now + 12 * 3_600_000 : now + d.ms
    onGrant({ granted: true, grantedAt: now, expiresAt, mode, maxPerCommand: maxN, dailyLimit: dayN, scopes })
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 text-xs font-semibold">How long</div>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDuration(d.id)}
              aria-pressed={duration === d.id}
              className={clsx('press min-h-[44px] rounded-lg border px-3 text-xs font-semibold', duration === d.id ? 'border-transparent bg-accent text-accent-ink' : 'border-control bg-panel hover:bg-raised')}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-semibold">Before each command runs</div>
        <Segmented className="w-full" value={mode} onChange={setMode} options={[{ id: 'confirm', label: 'Ask "is this exact?"' }, { id: 'auto', label: 'Run inside limits' }]} />
        <p className="mt-1.5 text-xs text-mute">{mode === 'confirm' ? 'The agent reads every command back and waits for your yes.' : 'Commands inside the limits run right after the readback. Anything bigger, or anything it cannot price, still waits for your yes.'}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Largest command" value={maxCmd} onChange={(e) => setMaxCmd(e.target.value)} right="USDC" error={maxCmd !== '' && !(maxN > 0) ? 'Above 0' : null} />
        <Field label="Largest per day" value={daily} onChange={(e) => setDaily(e.target.value)} right="USDC" error={daily !== '' && !(dayN >= maxN) ? 'At least the per-command limit' : null} />
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold">What it may do</div>
        <div className="divide-y divide-line rounded-lg border border-line px-3">
          {(Object.keys(SCOPE_LABEL) as AgentScope[]).map((k) => (
            <Switch key={k} checked={scopes[k]} onChange={(v) => setScopes({ ...scopes, [k]: v })} label={SCOPE_LABEL[k]} />
          ))}
        </div>
      </div>

      <Button variant="primary" className="w-full" disabled={!valid} onClick={grant}>
        Allow the agent
      </Button>
      <p className="text-xs text-mute">Your wallet still asks you to approve every transaction. You can change or revoke this at any time.</p>
    </div>
  )
}

/** One message. The agent's carries the Tactora mark, the user's sits on the right. */
function Message({ children, mine }: { children: ReactNode; mine?: boolean }) {
  if (mine) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-accent-ink sm:max-w-[80%]">{children}</div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2.5">
      <img src="/tactora-mark-wide.png" alt="" aria-hidden="true" className="mt-1 hidden h-5 w-auto shrink-0 sm:block" />
      <div className="min-w-0 max-w-full flex-1 rounded-2xl rounded-tl-md border border-line bg-panel px-4 py-3 text-sm sm:max-w-[88%]">{children}</div>
    </div>
  )
}

/** Labelled values in a grid. Used for the interpreted strategy and for the exact terms. */
function Fields({ fields, dense }: { fields: [string, string][]; dense?: boolean }) {
  return (
    <dl className="flex flex-wrap gap-px overflow-hidden rounded-lg border border-line bg-line">
      {fields.map(([k, v], i) => (
        <div key={`${k}-${i}`} className={clsx('min-w-0 grow bg-raised px-3 py-2', dense ? 'basis-[7rem]' : 'basis-[8.5rem]')}>
          <dt className="text-[11px] text-mute">{k}</dt>
          <dd className="num mt-0.5 break-words text-[13px] font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const STATE_TAG: Record<ConfirmState, { label: string; tone: 'accent' | 'warn' | 'up' | 'down' | 'mute' }> = {
  waiting: { label: 'Proposal', tone: 'accent' },
  running: { label: 'Waiting for wallet', tone: 'warn' },
  done: { label: 'Confirmed', tone: 'up' },
  failed: { label: 'Failed', tone: 'down' },
  cancelled: { label: 'Not sent', tone: 'mute' },
}

const STEPS = ['Interpreted', 'Review', 'Approve', 'Result'] as const

/** Where a strategy is in its life. A proposal is only ever at "Review": nothing is sent until the wallet approves. */
function Steps({ state }: { state: ConfirmState }) {
  const at = state === 'waiting' ? 1 : state === 'running' || state === 'failed' ? 2 : state === 'done' ? 3 : -1
  return (
    <ol className="flex items-center gap-1.5 text-[11px]" aria-label="Progress">
      {STEPS.map((label, i) => {
        const complete = state === 'done' ? i <= 3 : i < at
        const current = i === at && state !== 'done'
        const bad = current && state === 'failed'
        return (
          <li key={label} className="flex items-center gap-1.5" aria-current={current ? 'step' : undefined}>
            <span
              className={clsx(
                'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                bad ? 'bg-down text-canvas' : complete ? 'bg-accent text-accent-ink' : current ? 'border-2 border-[rgb(var(--ring))] text-ink' : 'border border-control text-mute',
              )}
            >
              {complete ? <Check className="h-3 w-3" aria-hidden="true" /> : bad ? <X className="h-3 w-3" aria-hidden="true" /> : i + 1}
            </span>
            <span className={clsx(current || complete ? 'font-semibold text-ink' : 'text-mute', i > 0 && 'hidden sm:inline', current && 'inline')}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px w-3 bg-control sm:w-5" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}

type View = 'chat' | 'permission' | 'commands'

/** Plain-words prompts for the empty state. Each one goes through the real chat rules, so every card does something. */
function starters(sym: string): { title: string; text: string; run?: boolean }[] {
  return [
    { title: 'Buy a dip', text: `Buy $100 worth of ${sym} when the price drops 5%` },
    { title: 'Average in', text: `DCA $500 into ${sym} over the next 7 days` },
    { title: 'Protect a position', text: `Create an OCO order for ${sym}` },
    { title: 'Ask for ideas', text: 'What should I do with what I hold?', run: true },
  ]
}

export function AgentStation({ network }: { network: NetworkConfig }) {
  const s = useSettings()
  const engine = useAgentEngine(network)
  const tokens = useTokenList(network).tokens
  const account = useAccountSummary(network)
  const health = useBackendHealth()
  const modelOn = health.data?.agentChat?.enabled === true
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState(() => takeAgentPrefill())
  const [thinking, setThinking] = useState(false)
  const [spent, setSpent] = useState(() => loadSpentToday())
  const [view, setView] = useState<View>('chat')
  const nextId = useRef(1)
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesRef = useRef<Msg[]>([])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const sample = tokens[0]?.symbol ?? 'tBTC'
  // The prompt examples talk about ETH when the list has it, and about the first listed token otherwise.
  const example = tokens.find((t) => /^[wt]?eth$/i.test(t.symbol))?.symbol ?? sample
  const nowMs = useNowSeconds(10_000) * 1000
  const active = isGrantActive(s.agent, nowMs)

  // What the chat layer may look at: symbols, oracle prices and what the wallet holds. It never leaves the browser
  // unless the operator's optional model is on, and then only the typed message and the symbol list are sent.
  const chatCtx = useMemo<ChatContext>(() => {
    const q = network.quote
    const symbolOf = new Map(account.rows.map((r) => [r.token.address.toLowerCase(), r.token.symbol]))
    const prices: Record<string, number> = {}
    for (const b of network.bases) {
      const o = account.prices[b.address.toLowerCase()]
      if (o?.status === 'ok') prices[b.symbol] = Number(formatUnits(o.price18, 18))
    }
    const holdings = account.rows
      .filter((r) => r.token.address !== q.address && r.available + r.locked > 0n)
      .map((r) => ({ symbol: r.token.symbol, amount: Number(formatUnits(r.available + r.locked, r.token.decimals)), price: prices[r.token.symbol] ?? null }))
    const stopTypes: number[] = [OrderType.STOP_LOSS, OrderType.STOP_LIMIT, OrderType.TRAILING_STOP, OrderType.OCO]
    const protectedSymbols = account.orders
      .filter((o) => o.status === Status.OPEN && o.side === Side.SELL && stopTypes.includes(o.orderType))
      .map((o) => symbolOf.get(o.base.toLowerCase()))
      .filter((x): x is string => Boolean(x))
    const quoteRow = account.rows.find((r) => r.token.address === q.address)
    return {
      tokens: tokens.map((t) => ({ symbol: t.symbol, name: t.name })),
      quote: q.symbol,
      connected: account.connected,
      holdings,
      prices,
      freeQuote: quoteRow ? Number(formatUnits(quoteRow.available, q.decimals)) : 0,
      protectedSymbols,
      activeDca: account.dcas.filter((d) => d.status === DcaStatus.ACTIVE).length,
    }
  }, [account, network, tokens])

  const COMMANDS = useMemo(
    () => [
      { group: 'Swap', items: [`buy 10 USDC of ${sample}`, `sell 50% of ${sample}`] },
      { group: 'Orders', items: [`limit buy ${sample} 5 USDC at 70000`, `stop loss 0.001 ${sample} at 80000`, `take profit 0.001 ${sample} at 100000`, `trailing stop 0.001 ${sample} 5%`, `oco 0.001 ${sample} sl 80000 tp 100000`] },
      { group: 'DCA', items: [`dca 1 USDC into ${sample} daily for 7 days`] },
      { group: 'Manage', items: ['cancel order 12', 'pause dca 3', 'resume dca 3', 'cancel dca 3'] },
      { group: 'Look up', items: [`price ${sample}`, 'balance', 'orders', 'help'] },
    ],
    [sample],
  )

  const push = useCallback((m: NewMsg) => {
    const id = nextId.current++
    setMessages((prev) => [...prev.slice(-99), { ...m, id }])
    return id
  }, [])
  const patch = useCallback((id: number, change: Partial<Extract<Msg, { kind: 'confirm' }>>) => {
    setMessages((prev) => prev.map((m) => (m.id === id && m.role === 'agent' && m.kind === 'confirm' ? { ...m, ...change } : m)))
  }, [])

  useEffect(() => {
    // The empty state is read from the top; only a conversation follows its newest message.
    if (messages.length === 0) return
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  const say = useCallback((text: string, extra: { lines?: [string, string][]; linesTitle?: string; tone?: 'error'; suggestions?: Suggestion[] } = {}) => push({ role: 'agent', kind: 'text', text, ...extra }), [push])

  const run = useCallback(
    async (id: number, plan: Plan) => {
      patch(id, { state: 'running', progress: 'Starting...' })
      try {
        const result = await plan.run((progress) => patch(id, { progress }))
        if (plan.valueUsdc) setSpent(addSpent(plan.valueUsdc))
        patch(id, { state: 'done', result, progress: undefined })
      } catch (e) {
        const msg = e instanceof Error && e.message && !/^(Something|The transaction)/.test(parseOnchainError(e)) ? parseOnchainError(e) : e instanceof Error ? e.message : 'Something went wrong.'
        patch(id, { state: 'failed', error: msg, progress: undefined })
      }
    },
    [patch],
  )

  const startAction = useCallback(
    async (text: string, intent: Intent, skipGrantCheck = false) => {
      if (!engine.connected) {
        // The strategy is still understood without a wallet, so show how it was read.
        const view = describeIntent(intent, chatCtx.tokens.map((t) => t.symbol))
        say('Connect your wallet to turn this into a plan with live prices. Nothing has been prepared or sent.', { lines: view?.fields, linesTitle: view ? `Understood as: ${view.label}` : undefined })
        return
      }
      if (!skipGrantCheck && !isGrantActive(s.agent, Date.now())) {
        push({ role: 'agent', kind: 'grant', pending: text, open: true })
        return
      }
      setThinking(true)
      try {
        const built = await engine.buildPlan(intent)
        if (!built.ok) {
          say(built.error, { tone: 'error' })
          return
        }
        const plan = built.plan
        const gate = gateCommand(s.agent, plan.scope, plan.valueUsdc, loadSpentToday(), Date.now(), plan.protective)
        if (!gate.allowed) {
          say(`${gate.reason} Change the limits in the permission panel if you want to allow it.`, { tone: 'error' })
          return
        }
        const id = push({ role: 'agent', kind: 'confirm', intent, command: text, plan, state: 'waiting', auto: gate.autoRun })
        if (gate.autoRun) {
          setThinking(false)
          await run(id, plan)
        }
      } finally {
        setThinking(false)
      }
    },
    [engine, s.agent, say, push, run, chatCtx.tokens],
  )

  const confirmLatest = useCallback(async () => {
    const waiting = [...messagesRef.current].reverse().find((m) => m.role === 'agent' && m.kind === 'confirm' && m.state === 'waiting') as Extract<Msg, { kind: 'confirm' }> | undefined
    if (!waiting) {
      say('There is nothing waiting for a yes. Send a command first.')
      return
    }
    if (!isGrantActive(s.agent, Date.now())) {
      patch(waiting.id, { state: 'cancelled' })
      push({ role: 'agent', kind: 'grant', pending: null, open: true })
      return
    }
    // A quote older than a minute may no longer be what the user read. Rebuild and ask again.
    if (Date.now() - waiting.plan.builtAt > STALE_MS) {
      patch(waiting.id, { state: 'cancelled', note: 'Expired' })
      setThinking(true)
      try {
        const built = await engine.buildPlan(waiting.intent)
        if (!built.ok) return void say(built.error, { tone: 'error' })
        push({ role: 'agent', kind: 'confirm', intent: waiting.intent, command: waiting.command, plan: built.plan, state: 'waiting', auto: false, note: 'Prices may have moved while you were reading, so here is the fresh version. Confirm again if it is still right.' })
      } finally {
        setThinking(false)
      }
      return
    }
    await run(waiting.id, waiting.plan)
  }, [engine, s.agent, say, push, patch, run])

  const cancelLatest = useCallback(() => {
    const waiting = [...messagesRef.current].reverse().find((m) => m.role === 'agent' && m.kind === 'confirm' && m.state === 'waiting')
    if (!waiting) return void say('There is nothing to cancel.')
    patch(waiting.id, { state: 'cancelled' })
    say('Cancelled. Nothing was sent.')
  }, [say, patch])

  /** Puts a strategy's command back in the composer so its numbers can be changed. A waiting proposal is dropped. */
  const edit = useCallback(
    (m: Extract<Msg, { kind: 'confirm' }>) => {
      if (m.state === 'waiting') patch(m.id, { state: 'cancelled', note: 'Sent back for editing. Nothing was sent.' })
      setInput(m.command)
      setView('chat')
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    [patch],
  )

  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || thinking) return
      setInput('')
      if (inputRef.current) inputRef.current.style.height = ''
      push({ role: 'user', text })
      if (YES.test(text)) return void (await confirmLatest())
      if (NO.test(text)) return cancelLatest()

      // 1. The strict grammar. 2. Plain wording, read by fixed rules (free). 3. The operator's optional model.
      // Every route ends in the same place: one command of the grammar, a readback, and a wallet signature.
      let intent: Intent | null = null
      let source = text
      const strict = parseCommand(text)
      if (strict.ok) intent = canonicalizeIntent(strict.intent, chatCtx.tokens)
      else {
        const chat = interpretChat(text, chatCtx)
        if (chat.kind === 'reply') return void say(chat.text, { suggestions: chat.suggestions?.length ? chat.suggestions : undefined })
        if (chat.kind === 'command') {
          const p = parseCommand(chat.command)
          if (p.ok) {
            intent = p.intent
            source = chat.command
            say(chat.note)
          }
        }
        if (!intent && modelOn) {
          setThinking(true)
          try {
            const out = await askAgentModel(text, chatCtx.tokens.map((t) => t.symbol), chatCtx.quote)
            const p = out.command ? parseCommand(out.command) : null
            if (p?.ok && out.command) {
              intent = p.intent
              source = out.command
              say(`${out.reply ? out.reply + '\n' : ''}I read that as: ${out.command} (from the chat model, check the numbers below).`)
            } else {
              say(out.reply || `I could not turn that into an order. ${strict.error}`, { tone: out.reply ? undefined : 'error' })
              return
            }
          } catch (e) {
            say(`The chat model is not available right now (${e instanceof Error ? e.message : 'error'}). ${strict.error}`, { tone: 'error' })
            return
          } finally {
            setThinking(false)
          }
        }
        if (!intent) {
          say(strict.error + (strict.example ? `\nExample: ${strict.example}` : '') + '\nYou can also write it in your own words, or ask "what should I do?".', { tone: 'error' })
          return
        }
      }

      if (intent.kind === 'help' || intent.kind === 'balance' || intent.kind === 'orders' || intent.kind === 'price') {
        setThinking(true)
        try {
          const a: Answer = await engine.answer(intent)
          say(a.text ?? '', { lines: a.lines.length ? a.lines : undefined })
        } finally {
          setThinking(false)
        }
        return
      }
      // A new action replaces any readback still waiting, so a stray "yes" can only confirm the latest command.
      for (const m of messagesRef.current) if (m.role === 'agent' && m.kind === 'confirm' && m.state === 'waiting') patch(m.id, { state: 'cancelled', note: 'Replaced by a newer command' })
      await startAction(source, intent)
    },
    [thinking, push, confirmLatest, cancelLatest, say, engine, patch, startAction, chatCtx, modelOn],
  )

  // After a grant, `s.agent` has not re-rendered yet; run the first command with the fresh permission.
  const startActionWith = async (p: AgentPermission, intent: Intent, command: string) => {
    if (!engine.connected) return say('Connect your wallet first, then send the command again.', { tone: 'error' })
    setThinking(true)
    try {
      const built = await engine.buildPlan(intent)
      if (!built.ok) return void say(built.error, { tone: 'error' })
      const gate = gateCommand(p, built.plan.scope, built.plan.valueUsdc, loadSpentToday(), Date.now(), built.plan.protective)
      if (!gate.allowed) return void say(gate.reason, { tone: 'error' })
      const id = push({ role: 'agent', kind: 'confirm', intent, command, plan: built.plan, state: 'waiting', auto: gate.autoRun })
      if (gate.autoRun) {
        setThinking(false)
        await run(id, built.plan)
      }
    } finally {
      setThinking(false)
    }
  }

  const onGrant = (p: AgentPermission, pending: string | null, grantMsgId?: number) => {
    s.setAgent(p)
    if (grantMsgId !== undefined) setMessages((prev) => prev.map((m) => (m.id === grantMsgId && m.role === 'agent' && m.kind === 'grant' ? { ...m, open: false } : m)))
    say(`Permission granted${p.expiresAt ? ` until ${new Date(p.expiresAt).toLocaleString()}` : ' until you revoke it'}. Limits: ${p.maxPerCommand} USDC per command, ${p.dailyLimit} USDC per day.`)
    if (pending) {
      // Carry on with the command that asked for permission, using the grant that was just made.
      const parsed = parseCommand(pending)
      if (parsed.ok) void startActionWith(p, parsed.intent, pending)
    }
  }

  const insert = (command: string) => {
    setInput(command)
    setView('chat')
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    })
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit(input)
    }
  }

  const chatHidden = view !== 'chat' ? 'hidden lg:flex' : 'flex'
  const sideHidden = (v: View) => (view !== v ? 'hidden lg:block' : 'block')
  const cards = starters(example)

  return (
    <div className="mx-auto max-w-[1280px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-3xl sm:text-4xl">Agent</h1>
          <p className="mt-1 max-w-xl text-sm text-mute">Describe a strategy. The agent reads it back as a proposal with exact numbers. You review it, edit it if you want, and approve it in your wallet.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={active ? 'up' : 'warn'}>{active ? 'Permission granted' : 'Permission not granted'}</Badge>
          <Badge tone="mute">{modelOn ? 'Chat model on' : 'Rules on your device'}</Badge>
          <Badge tone="mute">{network.isTestnet ? 'Testnet' : 'Mainnet'}</Badge>
        </div>
      </div>

      <div className="mb-3 lg:hidden">
        <Segmented className="w-full" value={view} onChange={setView} options={[{ id: 'chat', label: 'Chat' }, { id: 'permission', label: 'Permission' }, { id: 'commands', label: 'Commands' }]} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel raised className={clsx('min-w-0 flex-col', chatHidden, 'h-[calc(100dvh-19rem)] min-h-[420px] lg:h-[calc(100dvh-12.5rem)] lg:min-h-[520px]')}>
          <div ref={scroller} className="thin-scroll flex-1 space-y-4 overflow-y-auto p-3 sm:p-5" role="log" aria-live="polite" aria-label="Agent conversation">
            {messages.length === 0 && (
              <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 py-4">
                <div>
                  <h2 className="text-2xl sm:text-3xl">What do you want to trade?</h2>
                  <p className="mt-2 text-sm text-mute">Write it the way you would say it. Nothing is sent until you review the proposal and your wallet signs.</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {cards.map((c) => (
                    <button key={c.title} onClick={() => (c.run ? void submit(c.text) : insert(c.text))} className="press rounded-xl border border-line bg-raised p-3.5 text-left hover:border-control">
                      <span className="block text-sm font-semibold">{c.title}</span>
                      <span className="mt-1 block text-[13px] leading-snug text-mute">{c.text}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-mute">
                  {modelOn
                    ? "Wording the built-in rules cannot read may be sent to the operator's language model. Only your message and the token symbols are sent, never balances or your address."
                    : 'Messages are read by fixed rules on your device. Nothing is sent anywhere and it costs nothing.'}{' '}
                  Everything the agent proposes comes from a fixed set of commands, so the proposal always matches what will run.
                </p>
              </div>
            )}

            {messages.map((m) => {
              if (m.role === 'user') return <Message key={m.id} mine>{m.text}</Message>
              if (m.kind === 'text') {
                return (
                  <Message key={m.id}>
                    {m.text && <div className={clsx('whitespace-pre-wrap break-words', m.tone === 'error' && 'font-semibold text-down')}>{m.text}</div>}
                    {m.lines && (
                      <div className="mt-3">
                        {m.linesTitle && <div className="mb-1.5 text-xs font-semibold">{m.linesTitle}</div>}
                        <Fields fields={m.lines} />
                      </div>
                    )}
                    {m.suggestions && (
                      <ul className="mt-3 space-y-2">
                        {m.suggestions.map((sg) => (
                          <li key={sg.label + sg.command}>
                            <button
                              onClick={() => (sg.mode === 'run' ? void submit(sg.command) : insert(sg.command))}
                              disabled={thinking}
                              className="press w-full rounded-lg border border-control bg-raised px-3 py-2.5 text-left hover:bg-panel disabled:opacity-50"
                            >
                              <span className="block text-xs font-semibold">{sg.label}</span>
                              <span className="num mt-0.5 block break-words text-xs">{sg.command}</span>
                              <span className="mt-1 block text-xs text-mute">{sg.why}</span>
                              <span className="mt-1 block text-[11px] font-semibold text-brand">{sg.mode === 'run' ? 'Review the exact terms' : 'Put it in the box and edit'}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Message>
                )
              }
              if (m.kind === 'grant') {
                return (
                  <Message key={m.id}>
                    <div className="flex items-center gap-2 text-base font-semibold">
                      <ShieldCheck className="h-4 w-4 text-brand" aria-hidden="true" /> Allow the agent to act for you?
                    </div>
                    <p className="mt-1 text-xs text-mute">You do this once. After that, commands inside your limits do not ask for permission again. Your wallet still signs every transaction.</p>
                    {m.open ? (
                      <div className="mt-3">
                        <GrantForm initial={s.agent.granted ? s.agent : DEFAULT_AGENT} onGrant={(p) => onGrant(p, m.pending, m.id)} />
                      </div>
                    ) : (
                      <p className="mt-2 text-xs font-semibold text-up">Granted.</p>
                    )}
                  </Message>
                )
              }
              const tag = STATE_TAG[m.state]
              const view = describeIntent(m.intent, chatCtx.tokens.map((t) => t.symbol))
              return (
                <Message key={m.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Steps state={m.state} />
                    <Badge tone={tag.tone}>{tag.label}</Badge>
                  </div>
                  <h3 className="mt-3 text-lg">{m.plan.title}</h3>
                  {m.state === 'waiting' && <p className="text-xs text-mute">This is a proposal. Nothing has been sent, and nothing runs until you approve it in your wallet.</p>}
                  {m.note && <p className="mt-1 text-xs font-semibold text-warn">{m.note}</p>}

                  {view && (
                    <div className="mt-3">
                      <div className="mb-1.5 text-xs font-semibold">How I read your request</div>
                      <Fields fields={view.fields} dense />
                    </div>
                  )}
                  <div className="mt-3">
                    <div className="mb-1.5 text-xs font-semibold">Exact terms from live prices</div>
                    <Fields fields={m.plan.lines} />
                  </div>
                  {m.plan.warnings.length > 0 && m.state === 'waiting' && (
                    <ul className="mt-3 space-y-1 rounded-lg border border-line bg-raised p-3 text-xs text-mute">
                      {m.plan.warnings.map((w) => (
                        <li key={w} className="flex gap-2">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warn" aria-hidden="true" />
                          {w}
                        </li>
                      ))}
                    </ul>
                  )}

                  {m.state === 'waiting' && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="primary" className="min-w-[10rem] flex-1" onClick={() => void confirmLatest()}>
                        Approve and sign
                      </Button>
                      <Button onClick={() => edit(m)}>
                        <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
                      </Button>
                      <Button onClick={cancelLatest}>Cancel</Button>
                    </div>
                  )}
                  {m.state === 'running' && (
                    <div className="mt-4 flex items-center gap-2 rounded-lg bg-raised px-3 py-2.5 text-xs font-semibold" role="status">
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                      <span>
                        {m.auto ? 'Running inside your limits. ' : ''}
                        {m.progress}
                      </span>
                    </div>
                  )}
                  {m.state === 'done' && m.result && (
                    <div className="mt-4 space-y-1.5 rounded-lg border border-line bg-raised p-3 text-xs">
                      <div className="font-semibold text-up">{m.result.summary}</div>
                      {m.result.hashes.map((h) => (
                        <a key={h} href={buildTxExplorerUrl(network.chainId, h)} target="_blank" rel="noopener noreferrer" className="num flex items-center gap-1 underline underline-offset-2">
                          {h.slice(0, 10)}...{h.slice(-6)} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                  )}
                  {m.state === 'failed' && (
                    <div className="mt-4 space-y-2">
                      <div className="rounded-lg border border-down/50 bg-raised p-3 text-xs font-semibold text-down" role="alert">
                        Nothing was completed: {m.error}
                      </div>
                      <Button onClick={() => edit(m)}>
                        <RotateCcw className="h-4 w-4" aria-hidden="true" /> Edit and try again
                      </Button>
                    </div>
                  )}
                  {m.state === 'cancelled' && (
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-mute">
                      <span>{m.note ?? 'Cancelled. Nothing was sent.'}</span>
                      <button onClick={() => edit(m)} className="min-h-[32px] font-semibold text-ink underline underline-offset-2">
                        Use this command again
                      </button>
                    </div>
                  )}
                </Message>
              )
            })}

            {thinking && (
              <Message>
                <div className="flex items-center gap-2 text-mute" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading your request and checking live prices and balances...
                </div>
                <div className="mt-3 space-y-2" aria-hidden="true">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-raised" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-raised" />
                </div>
              </Message>
            )}
          </div>

          <form
            className="border-t border-line p-3 sm:p-4"
            onSubmit={(e) => {
              e.preventDefault()
              void submit(input)
            }}
          >
            <label className="sr-only" htmlFor="agent-command">
              Describe a strategy or type a command
            </label>
            <div className="flex items-end gap-2 rounded-xl border border-control bg-raised p-2 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[rgb(var(--ring))]">
              <textarea
                id="agent-command"
                ref={inputRef}
                rows={2}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  e.currentTarget.style.height = 'auto'
                  e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 160)}px`
                }}
                onKeyDown={onKey}
                placeholder={`Describe a strategy, for example: Buy $100 worth of ${example} when the price drops 5%`}
                autoComplete="off"
                className="min-h-[52px] min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink outline-none placeholder:text-mute"
              />
              <button type="submit" disabled={!input.trim() || thinking} aria-label="Send" className="press grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                {thinking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowUp className="h-5 w-5" aria-hidden="true" />}
              </button>
            </div>
            <p className="mt-2 hidden text-[11px] text-mute sm:block">Enter sends, Shift and Enter adds a line. You can also type a command such as buy 10 USDC of {sample}.</p>
          </form>
        </Panel>

        <aside className="min-w-0 space-y-4">
          <div className={sideHidden('permission')}>
            <PermissionPanel spent={spent} onReset={() => setSpent(0)} />
          </div>
          <div className={sideHidden('commands')}>
            <Panel className="p-4">
              <h2 className="text-lg">Commands</h2>
              <p className="mb-3 mt-0.5 text-xs text-mute">Tap one to put it in the box. Change the numbers, then send.</p>
              <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {COMMANDS.map((g, i) => (
                  <details key={g.group} open={i === 0} className="group">
                    <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-3 text-sm font-semibold hover:bg-raised">
                      {g.group}
                      <span className="num text-xs font-normal text-mute group-open:hidden">{g.items.length}</span>
                    </summary>
                    <ul className="space-y-1.5 px-2 pb-2">
                      {g.items.map((c) => (
                        <li key={c}>
                          <button onClick={() => insert(c)} className="num min-h-[40px] w-full rounded-md border border-line bg-raised px-2.5 text-left text-xs hover:border-control">
                            {c}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </Panel>
          </div>
          <div className="hidden lg:block">
            <Panel className="p-4">
              <h2 className="text-lg">How it stays safe</h2>
              <ul className="mt-2 space-y-1.5 text-xs text-mute">
                <li>Your wallet signs every transaction. {BRAND.name} never holds keys.</li>
                <li>Every action is read back with exact amounts, prices and fees first.</li>
                <li>Limits per command and per day, and a switch for each kind of action.</li>
                <li>A plan older than a minute is rebuilt and shown again.</li>
                <li>It uses your slippage and expiry settings and the same checks as the order forms.</li>
              </ul>
            </Panel>
          </div>
        </aside>
      </div>
    </div>
  )
}

function PermissionPanel({ spent, onReset }: { spent: number; onReset: () => void }) {
  const s = useSettings()
  const p = s.agent
  const active = isGrantActive(p, useNowSeconds(10_000) * 1000)
  const [editing, setEditing] = useState(false)

  const row = (k: string, v: string) => (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2 text-xs last:border-b-0">
      <span className="text-mute">{k}</span>
      <span className="num text-right font-semibold">{v}</span>
    </div>
  )

  return (
    <Panel className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg">Permission</h2>
        <Badge tone={active ? 'up' : p.granted ? 'down' : 'mute'}>{active ? 'Granted' : p.granted ? 'Expired' : 'Not granted'}</Badge>
      </div>

      {active && !editing ? (
        <>
          <div className="rounded-lg border border-line px-3">
            {row('Until', p.expiresAt ? new Date(p.expiresAt).toLocaleString() : 'You revoke it')}
            {row('Before running', p.mode === 'auto' ? 'Run inside limits' : 'Ask "is this exact?"')}
            {row('Largest command', `${p.maxPerCommand} USDC`)}
            {row('Largest per day', `${p.dailyLimit} USDC`)}
            {row('Used today', `${spent.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`)}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-raised" role="img" aria-label={`${Math.round(p.dailyLimit > 0 ? Math.min(100, (spent / p.dailyLimit) * 100) : 0)} percent of today's limit used`}>
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, p.dailyLimit > 0 ? (spent / p.dailyLimit) * 100 : 0)}%` }} />
          </div>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" onClick={() => setEditing(true)}>
              Change
            </Button>
            <Button variant="danger" className="flex-1" onClick={() => s.setAgent({ ...p, granted: false })}>
              Revoke
            </Button>
          </div>
          <button
            className="mt-2 min-h-[32px] text-xs font-semibold underline underline-offset-2"
            onClick={() => {
              localStorage.removeItem('lumarc-agent-usage-v1')
              onReset()
            }}
          >
            Reset today's usage
          </button>
        </>
      ) : (
        <>
          <p className="mb-3 text-xs text-mute">Grant it once. It keeps working inside the limits you set, until it expires or you revoke it.</p>
          <GrantForm
            initial={p.granted ? p : DEFAULT_AGENT}
            onGrant={(next) => {
              s.setAgent(next)
              setEditing(false)
            }}
          />
        </>
      )}
    </Panel>
  )
}
