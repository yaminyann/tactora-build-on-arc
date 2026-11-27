/**
 * Language-model providers for the Agent chat, chosen by the admin and used with a fallback.
 *
 * The Agent understands plain wording with free built-in rules first. Only wording those rules cannot read goes to a
 * model, so cost stays near zero. Which model is used is an admin decision:
 *   - one slot switched on: that model is used;
 *   - two slots: the first is tried, and the second answers only if the first fails or times out.
 *
 * API keys live in the server environment (.env), never in this file and never in the browser. The admin page only
 * sees whether a key is present. The choice (provider and model per slot) is kept in a small JSON file in the data
 * directory so it survives restarts.
 *
 * What a model may do is unchanged (see agent-chat.ts): it sees one message and the token symbols, and may return a
 * short reply and at most one command that must pass the strict command parser. It cannot send a transaction.
 */
import fs from 'node:fs'
import path from 'node:path'
import { askModel, type AgentChatConfig, type AgentChatInput, type AgentChatOutput } from './agent-chat'

export type ProviderId = 'openrouter' | 'openai' | 'gemini' | 'custom'

export interface Preset {
  model: string
  label: string
  /** Plain-words cost note. Prices change, so this is a guide and not a quote. */
  cost: string
}

export interface ProviderDef {
  id: ProviderId
  label: string
  baseUrl: string | null
  keyEnv: string
  /** A key is not needed (a local model server). */
  keyless?: boolean
  headers?: Record<string, string>
  signup: string
  note: string
  presets: Preset[]
}

export const PROVIDERS: readonly ProviderDef[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    headers: { 'x-title': 'Tactora' },
    signup: 'https://openrouter.ai/keys',
    note: 'One key, many models. Models ending in :free cost nothing and are rate-limited.',
    presets: [
      { model: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (free)', cost: 'Free, limited requests per day' },
      { model: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B (free)', cost: 'Free, limited requests per day' },
      { model: 'openai/gpt-4o-mini', label: 'GPT-4o mini', cost: 'About $0.15 in, $0.60 out per million tokens' },
      { model: 'openai/gpt-4.1-nano', label: 'GPT-4.1 nano', cost: 'About $0.10 in, $0.40 out per million tokens' },
      { model: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', cost: 'About $0.10 in, $0.40 out per million tokens' },
      { model: 'mistralai/mistral-nemo', label: 'Mistral Nemo', cost: 'About $0.03 in, $0.07 out per million tokens' },
      { model: 'openai/gpt-oss-20b', label: 'gpt-oss 20B', cost: 'About $0.03 in, $0.14 out per million tokens' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    signup: 'https://platform.openai.com/api-keys',
    note: 'Paid per use, no free tier. The small models below cost a fraction of a cent per chat message.',
    presets: [
      { model: 'gpt-4o-mini', label: 'GPT-4o mini', cost: 'About $0.15 in, $0.60 out per million tokens' },
      { model: 'gpt-4.1-nano', label: 'GPT-4.1 nano', cost: 'About $0.10 in, $0.40 out per million tokens' },
      { model: 'gpt-4.1-mini', label: 'GPT-4.1 mini', cost: 'About $0.40 in, $1.60 out per million tokens' },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    signup: 'https://aistudio.google.com/apikey',
    note: 'The Google AI Studio key has a free tier with daily limits.',
    presets: [
      { model: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', cost: 'Free tier, limited requests per day' },
      { model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', cost: 'Free tier, limited requests per day' },
    ],
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseUrl: null,
    keyEnv: 'AGENT_LLM_API_KEY',
    keyless: true,
    signup: 'https://ollama.com',
    note: 'Any OpenAI-compatible endpoint set with AGENT_LLM_URL, for example a local Ollama server. No fee.',
    presets: [{ model: 'llama3.2:3b', label: 'Llama 3.2 3B (local)', cost: 'Free on your own machine' }],
  },
]

export interface Slot {
  provider: ProviderId
  model: string
}

export interface LlmConfig {
  enabled: boolean
  primary: Slot | null
  fallback: Slot | null
  updatedAt: number
}

export const DEFAULT_LLM_CONFIG: LlmConfig = { enabled: false, primary: null, fallback: null, updatedAt: 0 }

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/\-@]{0,99}$/
const providerIds = new Set<string>(PROVIDERS.map((p) => p.id))

function sanitizeSlot(raw: unknown): Slot | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.provider !== 'string' || !providerIds.has(r.provider)) return null
  if (typeof r.model !== 'string' || !MODEL_RE.test(r.model.trim())) return null
  return { provider: r.provider as ProviderId, model: r.model.trim() }
}

/** Reads whatever was stored or sent and keeps only valid values. Never throws. */
export function sanitizeLlmConfig(raw: unknown, now = Date.now()): LlmConfig {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const primary = sanitizeSlot(r.primary)
  let fallback = sanitizeSlot(r.fallback)
  // The same model twice is not a fallback.
  if (primary && fallback && primary.provider === fallback.provider && primary.model === fallback.model) fallback = null
  return { enabled: r.enabled === true && primary !== null, primary, fallback: primary ? fallback : null, updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : now }
}

type Env = Record<string, string | undefined>

export function providerDef(id: ProviderId): ProviderDef {
  return PROVIDERS.find((p) => p.id === id)!
}

/** The API key for a provider from the environment, or undefined. */
export function providerKey(id: ProviderId, env: Env = process.env): string | undefined {
  return env[providerDef(id).keyEnv]?.trim() || undefined
}

export function providerBaseUrl(id: ProviderId, env: Env = process.env): string | null {
  if (id === 'custom') {
    const u = env.AGENT_LLM_URL?.trim().replace(/\/+$/, '')
    return u && /^https?:\/\//.test(u) ? u : null
  }
  return providerDef(id).baseUrl
}

/** Whether a provider can be called right now: it has an endpoint, and a key unless it needs none. */
export function providerReady(id: ProviderId, env: Env = process.env): boolean {
  const def = providerDef(id)
  if (!providerBaseUrl(id, env)) return false
  return def.keyless ? true : Boolean(providerKey(id, env))
}

export function slotToConfig(slot: Slot, env: Env = process.env, timeoutMs = 12_000): AgentChatConfig | null {
  const baseUrl = providerBaseUrl(slot.provider, env)
  if (!baseUrl) return null
  const def = providerDef(slot.provider)
  const apiKey = providerKey(slot.provider, env)
  if (!def.keyless && !apiKey) return null
  return { baseUrl, apiKey, model: slot.model, dailyCalls: 0, timeoutMs, headers: def.headers }
}

/** The configuration used when nobody has chosen one yet: the older AGENT_LLM_URL and AGENT_LLM_MODEL pair, if set. */
export function legacyConfig(env: Env = process.env): LlmConfig {
  const model = env.AGENT_LLM_MODEL?.trim()
  if (!providerBaseUrl('custom', env) || !model) return DEFAULT_LLM_CONFIG
  return sanitizeLlmConfig({ enabled: true, primary: { provider: 'custom', model } })
}

/** The choice of providers, kept in a small JSON file so it survives a restart. */
export class LlmConfigStore {
  private cfg: LlmConfig

  constructor(
    private readonly file: string,
    private readonly env: Env = process.env,
  ) {
    this.cfg = this.read()
  }

  private read(): LlmConfig {
    try {
      return sanitizeLlmConfig(JSON.parse(fs.readFileSync(this.file, 'utf8')))
    } catch {
      return legacyConfig(this.env)
    }
  }

  get(): LlmConfig {
    return this.cfg
  }

  set(raw: unknown, now = Date.now()): LlmConfig {
    const next = sanitizeLlmConfig({ ...(typeof raw === 'object' && raw !== null ? raw : {}), updatedAt: now }, now)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
    fs.renameSync(tmp, this.file)
    this.cfg = next
    return next
  }
}

export interface Attempt {
  slot: Slot
  role: 'primary' | 'fallback'
  ok: boolean
  ms: number
  error?: string
}

export interface ChainResult {
  out: AgentChatOutput | null
  used: Slot | null
  attempts: Attempt[]
}

export interface UsageRow {
  provider: ProviderId
  model: string
  calls: number
  failures: number
  lastError: string | null
}

/** Calls per provider and model today, so the admin can see what is being used and what fails. */
export class UsageTracker {
  private day = ''
  private rows = new Map<string, UsageRow>()
  constructor(private readonly now: () => number = Date.now) {}

  private roll() {
    const d = new Date(this.now()).toISOString().slice(0, 10)
    if (d !== this.day) {
      this.day = d
      this.rows.clear()
    }
  }

  record(slot: Slot, ok: boolean, error?: string) {
    this.roll()
    const key = `${slot.provider}:${slot.model}`
    const row = this.rows.get(key) ?? { provider: slot.provider, model: slot.model, calls: 0, failures: 0, lastError: null }
    row.calls += 1
    if (!ok) {
      row.failures += 1
      row.lastError = error ?? 'failed'
    }
    this.rows.set(key, row)
  }

  snapshot(): { day: string; rows: UsageRow[] } {
    this.roll()
    return { day: this.day, rows: [...this.rows.values()] }
  }
}

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : 'failed'
  // Provider error text can echo a request. Keep it short and strip anything that looks like a key.
  return m.replace(/(sk|or|AIza)[-_A-Za-z0-9]{12,}/g, '[key]').slice(0, 160)
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>

/**
 * Asks the chosen model, then the fallback if the first failed. A model that answers with a reply and no command is a
 * success (the user asked a question); only an error, a timeout or an unreadable answer moves on to the fallback.
 */
export async function runChain(cfg: LlmConfig, input: AgentChatInput, opts: { env?: Env; fetchImpl?: Fetch; usage?: UsageTracker; timeoutMs?: number } = {}): Promise<ChainResult> {
  const env = opts.env ?? process.env
  const result: ChainResult = { out: null, used: null, attempts: [] }
  if (!cfg.enabled || !cfg.primary) return result
  const slots: { slot: Slot; role: Attempt['role'] }[] = [{ slot: cfg.primary, role: 'primary' }, ...(cfg.fallback ? [{ slot: cfg.fallback, role: 'fallback' as const }] : [])]
  for (const { slot, role } of slots) {
    const callCfg = slotToConfig(slot, env, opts.timeoutMs)
    const started = Date.now()
    if (!callCfg) {
      const error = `${providerDef(slot.provider).label} has no API key or endpoint on this server`
      result.attempts.push({ slot, role, ok: false, ms: 0, error })
      opts.usage?.record(slot, false, error)
      continue
    }
    try {
      const out = await askModel(callCfg, input, opts.fetchImpl)
      if (out) {
        result.attempts.push({ slot, role, ok: true, ms: Date.now() - started })
        opts.usage?.record(slot, true)
        result.out = out
        result.used = slot
        return result
      }
      const error = 'the model answer could not be read'
      result.attempts.push({ slot, role, ok: false, ms: Date.now() - started, error })
      opts.usage?.record(slot, false, error)
    } catch (e) {
      const error = errorText(e)
      result.attempts.push({ slot, role, ok: false, ms: Date.now() - started, error })
      opts.usage?.record(slot, false, error)
    }
  }
  return result
}

/** What the admin page shows for each provider: whether it can be called, never the key itself. */
export function providerOverview(env: Env = process.env) {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    ready: providerReady(p.id, env),
    keyEnv: p.keyEnv,
    keyless: Boolean(p.keyless),
    keySet: Boolean(providerKey(p.id, env)),
    endpointSet: Boolean(providerBaseUrl(p.id, env)),
    signup: p.signup,
    note: p.note,
    presets: p.presets,
  }))
}

interface OpenRouterModel {
  id?: unknown
  name?: unknown
  context_length?: unknown
  pricing?: { prompt?: unknown; completion?: unknown }
}

/** Free and very cheap OpenRouter models, from its public model list (no key needed). Used for the admin's picker. */
export function pickCheapModels(raw: unknown, limit = 30): { id: string; name: string; perMillion: number; free: boolean }[] {
  const list = (raw as { data?: OpenRouterModel[] } | null)?.data
  if (!Array.isArray(list)) return []
  const out: { id: string; name: string; perMillion: number; free: boolean }[] = []
  for (const m of list) {
    if (typeof m.id !== 'string' || !MODEL_RE.test(m.id)) continue
    const prompt = Number(m.pricing?.prompt)
    const completion = Number(m.pricing?.completion)
    if (!Number.isFinite(prompt) || !Number.isFinite(completion)) continue
    const perMillion = (prompt + completion) * 1e6
    const free = m.id.endsWith(':free') || perMillion === 0
    if (!free && perMillion > 1.2) continue
    if (m.id.includes(':batch') || m.id.includes('image') || m.id.includes('audio')) continue
    if (typeof m.context_length === 'number' && m.context_length < 8000) continue
    out.push({ id: m.id, name: typeof m.name === 'string' ? m.name.slice(0, 80) : m.id, perMillion: Math.round(perMillion * 100) / 100, free })
  }
  return out.sort((a, b) => Number(b.free) - Number(a.free) || a.perMillion - b.perMillion).slice(0, limit)
}
