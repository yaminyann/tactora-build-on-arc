/**
 * Backend for the trading terminal.
 *  - GET /health   provider status. Public view is redacted; operators (see ADMIN_TOKEN) get full detail
 *  - GET /metrics  counters for operators only
 *  - GET /tokens   tradable token list for a chain (KyberSwap registry, filtered and cached)
 *  - GET /market/token, /market/candles   price, pool and chart data for any listed token (DexScreener and GeckoTerminal, free, cached)
 *  - GET /price    indicative 0x price (no transaction data), cached briefly and coalesced
 *  - GET /quote    firm 0x quote including the transaction to sign (never cached)
 *  - POST /agent-chat  optional language-model help for the Agent chat (off until an admin chooses a provider)
 *  - GET/PUT /admin/agent-llm, POST /admin/agent-llm/test, GET /admin/agent-llm/models   admin choice of chat model and fallback (operator only)
 *  - /admin/auth/*   wallet sign-in for platform admins (PLATFORM_ADMIN_ADDRESSES); /admin/session, /admin/platform/stats, /admin/secrets  platform dashboard (admin only)
 * Run with `bun run server`. The Vite dev server proxies /api to this process.
 *
 * Trust and abuse controls (env, all optional):
 *   TRUSTED_PROXY_HOPS  number of reverse proxies in front of this process. 0 (default) ignores
 *                       x-forwarded-for entirely, so clients cannot choose their own rate-limit bucket
 *   ALLOWED_ORIGINS     comma-separated browser origins allowed to call /price and /quote
 *   ADMIN_TOKEN         bearer token for /metrics and detailed /health. Unset: loopback-only, direct
 *   UPSTREAM_BUDGET_PER_MIN  global cap on calls to 0x from this process (default 600)
 *   PLATFORM_FEE_BPS / PLATFORM_FEE_RECIPIENT  fee on browser market swaps, paid by the aggregator (max 100 bps)
 *   PLATFORM_ADMIN_ADDRESSES  comma-separated wallets that may sign in to the platform dashboard
 *   SECRETS_ENCRYPTION_KEY  turns on saving API keys from the dashboard (stored encrypted in DATA_DIR/secrets.json)
 *   OPENROUTER_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / AGENT_LLM_URL / AGENT_LLM_DAILY_CALLS  chat model keys, see agent-llm.ts
 */
import { isApiError, parseQuoteRequest, ZEROEX_SUPPORTED_CHAINS } from './zerox'
import { gateway, readAllowance } from './gateway/instance'
import { NEUTRAL_TAKER, withTakerAllowance } from './gateway/gateway'
import { renderPrometheus } from './prometheus'
import { alerter } from './alerts'
import { keeperStatus, startKeeper } from './keeper'
import { listProviders } from './automation/providers'
import { metrics, RateLimiter, TtlCache } from './scale'
import { isOperator, originAllowed, parseList, resolveClientIp } from './security'
import { AdminSessions, bearerToken, parseAdminAddresses } from './admin-auth'
import { SecretStore, isSecretName, validSecretValue } from './secrets'
import { computePlatformStats } from './platform-stats'
import { erc20Abi, type Address } from 'viem'
import { getUsdc } from '../src/onchain-facts'
import { publicClientFor } from './rpc'
import { indexerDb, indexerStatus, startIndexer } from './indexer/runtime'
import { adminEventsFor, clampLimit, eventCounts, historyFor, platformRows, swapCount, swapsFor, validOwner } from './indexer/queries'
import { recordSwap } from './indexer/swaps'
import { swapTargetsFor } from './gateway/targets'
import { createTokenList } from './gateway/tokens'
import { DexData, TIMEFRAME_IDS, type Timeframe } from './market/dex'
import { parsePlatformFee } from './gateway/fee'
import { DailyBudget, parseAgentChatInput } from './agent-chat'
import { LlmConfigStore, PROVIDERS, UsageTracker, pickCheapModels, providerOverview, runChain, sanitizeLlmConfig, type ProviderId } from './agent-llm'

const port = Number(process.env.API_PORT ?? 3001)
const PRICE_TTL_MS = Number(process.env.PRICE_CACHE_TTL_MS ?? 4000)
const trustedHops = Math.max(0, Math.floor(Number(process.env.TRUSTED_PROXY_HOPS ?? 0)) || 0)
const allowedOrigins = parseList(process.env.ALLOWED_ORIGINS)
const adminToken = process.env.ADMIN_TOKEN || undefined

// Per-client limits per minute. Tune with RATE_LIMIT_SCALE (e.g. 2 doubles every limit).
const scale = Math.max(0.1, Number(process.env.RATE_LIMIT_SCALE ?? 1))
const limits = {
  price: new RateLimiter(Math.round(90 * scale), 60_000),
  quote: new RateLimiter(Math.round(20 * scale), 60_000),
  other: new RateLimiter(Math.round(240 * scale), 60_000),
  swaps: new RateLimiter(Math.round(30 * scale), 60_000),
  chat: new RateLimiter(Math.round(12 * scale), 60_000),
  login: new RateLimiter(Math.max(5, Math.round(15 * scale)), 60_000),
}

// Which chat model is used is the admin's choice, kept in the data directory. Keys come from the environment.
const llmStore = new LlmConfigStore(`${process.env.DATA_DIR ?? './data'}/agent-llm.json`)
const llmUsage = new UsageTracker()
const chatBudget = new DailyBudget(Math.max(1, Math.floor(Number(process.env.AGENT_LLM_DAILY_CALLS ?? 2000)) || 2000))
let openRouterModels: { at: number; models: ReturnType<typeof pickCheapModels> } | null = null

// Platform admins sign in with their wallet. ADMIN_TOKEN stays as the break-glass key.
const adminList = parseAdminAddresses(process.env.PLATFORM_ADMIN_ADDRESSES)
for (const p of adminList.problems) console.warn(`[api] ${p}`)
const sessions = new AdminSessions(adminList.addresses)
console.log(`[api] platform admins: ${adminList.addresses.length}`)
// Keys saved from the dashboard (encrypted). A saved key is copied into process.env, so existing code picks it up.
const secretStore = new SecretStore(`${process.env.DATA_DIR ?? './data'}/secrets.json`, process.env.SECRETS_ENCRYPTION_KEY || undefined)
if (secretStore.problem) console.warn(`[api] ${secretStore.problem}`)
let statsCache: { key: string; at: number; body: unknown } | null = null

const tokenList = createTokenList()
const dexData = new DexData({ geckoPerMinute: Math.max(1, Math.floor(Number(process.env.GECKO_CALLS_PER_MIN ?? 24)) || 24) })
const platform = parsePlatformFee()
if (platform.problem) console.warn(`[api] ${platform.problem}`)
if (platform.fee) console.log(`[api] platform fee ${platform.fee.bps} bps to ${platform.fee.recipient} on browser market swaps`)
/** Adds the platform fee to a browser swap request. Keepers call the gateway directly and never get it. */
const withFee = <T extends object>(req: T) => (platform.fee ? { ...req, fee: platform.fee } : req)

const priceCache = new TtlCache<{ status: number; body: unknown }>(PRICE_TTL_MS, 1000)
// Per-wallet allowance view of a shared price, cached just as briefly.
const allowanceCache = new TtlCache<{ status: number; body: unknown }>(PRICE_TTL_MS, 5000)

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  })
}

const server = Bun.serve({
  port,
  async fetch(req, srv) {
    metrics.http.requests += 1
    const url = new URL(req.url)
    const isSwapReport = req.method === 'POST' && url.pathname === '/swaps'
    const isChat = req.method === 'POST' && url.pathname === '/agent-chat'
    const isLlmAdmin = url.pathname.startsWith('/admin/agent-llm')
    const isAdminPath = url.pathname.startsWith('/admin/')
    if (req.method !== 'GET' && !isSwapReport && !isChat && !(isAdminPath && (req.method === 'PUT' || req.method === 'POST' || req.method === 'DELETE'))) {
      return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only (POST /swaps reports a confirmed swap, POST /agent-chat asks the optional chat model)' } }, 405)
    }

    const socketIp = srv.requestIP(req)?.address
    const bucket = url.pathname === '/price' ? 'price' : url.pathname === '/quote' ? 'quote' : isSwapReport ? 'swaps' : isChat ? 'chat' : url.pathname.startsWith('/admin/auth/') ? 'login' : 'other'
    const key = resolveClientIp(req.headers.get('x-forwarded-for'), socketIp, trustedHops)
    if (!limits[bucket].allow(key)) {
      metrics.http.rateLimited += 1
      return json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down and retry.' } }, 429, {
        'retry-after': String(limits[bucket].retryAfter(key)),
      })
    }

    // Operator = the ADMIN_TOKEN bearer, or a platform admin's wallet session. Both see detailed status and use admin routes.
    const session = sessions.verify(bearerToken(req.headers.get('authorization')))
    const operator = isOperator(req.headers, socketIp, adminToken) || session !== null

    if (url.pathname === '/health') {
      const keeper = keeperStatus()
      // The public view hides the keeper address and raw errors (an error string can embed an RPC URL).
      const view = operator
        ? keeper
        : { ...keeper, keeperAddress: null, lastError: keeper.lastError ? 'Keeper reported an error. Details are restricted to operators.' : null }
      return json({
        ok: true,
        zeroEx: { configured: gateway.status().some((p) => p.id === '0x' && p.configured), chains: [...ZEROEX_SUPPORTED_CHAINS] },
        gateway: { configured: gateway.configured, providers: gateway.status() },
        keeper: view,
        indexer: operator ? indexerStatus() : { ...indexerStatus(), lastError: indexerStatus().lastError ? 'Indexer reported an error. Details are restricted to operators.' : null },
        automationProviders: listProviders(),
        agentChat: { enabled: llmStore.get().enabled, mode: llmStore.get().fallback ? 'fallback' : 'single' },
        platformFee: platform.fee ? { bps: platform.fee.bps, ...(operator ? { recipient: platform.fee.recipient } : {}) } : null,
        ...(operator && platform.problem ? { platformFeeProblem: platform.problem } : {}),
      })
    }

    if (url.pathname === '/metrics') {
      if (!operator) return json({ error: { code: 'FORBIDDEN', message: 'Operator access required.' } }, 403)
      const uptimeSeconds = Math.floor((Date.now() - metrics.startedAt) / 1000)
      if (url.searchParams.get('format') === 'prometheus' || req.headers.get('accept')?.includes('text/plain')) {
        const text = renderPrometheus({ uptimeSeconds, http: metrics.http, keeper: metrics.keeper, providers: gateway.status(), priceCacheEntries: priceCache.size, nowMs: Date.now() })
        return new Response(text, { headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' } })
      }
      return json({
        uptimeSeconds,
        http: { ...metrics.http, priceCacheEntries: priceCache.size },
        keeper: metrics.keeper,
        gateway: gateway.status(),
      })
    }

    if (isChat) {
      if (!originAllowed(req.headers.get('origin'), req.headers.get('referer'), allowedOrigins)) {
        return json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This origin may not use the chat service.' } }, 403)
      }
      if (!llmStore.get().enabled) return json({ error: { code: 'AGENT_CHAT_DISABLED', message: 'The optional chat model is not switched on for this backend.' } }, 503)
      if (Number(req.headers.get('content-length') ?? 0) > 4000) return json({ error: { code: 'INPUT_INVALID', message: 'Message too large.' } }, 413)
      let body: unknown
      try {
        const raw = await req.text()
        if (raw.length > 4000) return json({ error: { code: 'INPUT_INVALID', message: 'Message too large.' } }, 413)
        body = JSON.parse(raw)
      } catch {
        return json({ error: { code: 'INPUT_INVALID', message: 'Body must be JSON: { "text": string, "tokens": string[], "quote": string }' } }, 400)
      }
      const input = parseAgentChatInput(body)
      if (!input) return json({ error: { code: 'INPUT_INVALID', message: 'A message of 1 to 300 characters and a short token list are required.' } }, 400)
      if (!chatBudget.take()) return json({ error: { code: 'AGENT_CHAT_BUDGET', message: 'The chat model has reached its daily limit. The built-in rules still work.' } }, 429)
      const chain = await runChain(llmStore.get(), input, { usage: llmUsage })
      if (!chain.out) {
        metrics.http.upstreamErrors += 1
        return json({ error: { code: 'AGENT_CHAT_UNAVAILABLE', message: 'The chat model did not answer. The built-in rules still work.' } }, 502)
      }
      return json({ reply: chain.out.reply, command: chain.out.command, via: chain.attempts.length > 1 ? 'fallback' : 'primary' })
    }

    if (url.pathname === '/admin/auth/status') {
      const a = url.searchParams.get('address')
      return json({ configured: sessions.configured, admin: validOwner(a) && sessions.isAdmin(a) })
    }
    if (url.pathname === '/admin/auth/challenge') {
      const a = url.searchParams.get('address')
      if (!validOwner(a)) return json({ error: { code: 'INPUT_INVALID', message: 'A wallet address is required.' } }, 400)
      const c = sessions.challenge(a)
      if (!c.ok) return json({ error: { code: c.code, message: c.message } }, 403)
      return json({ message: c.message, nonce: c.nonce })
    }
    if (url.pathname === '/admin/auth/login' && req.method === 'POST') {
      let body: { address?: unknown; nonce?: unknown; signature?: unknown } = {}
      try {
        body = (await req.json()) as typeof body
      } catch {
        return json({ error: { code: 'INPUT_INVALID', message: 'Body must be JSON.' } }, 400)
      }
      if (typeof body.address !== 'string' || typeof body.nonce !== 'string' || typeof body.signature !== 'string') return json({ error: { code: 'INPUT_INVALID', message: 'address, nonce and signature are required.' } }, 400)
      const r = await sessions.login(body.address, body.nonce, body.signature)
      if (!r.ok) return json({ error: { code: r.code, message: r.message } }, r.code === 'NOT_ADMIN' ? 403 : 401)
      return json({ token: r.token, address: r.address, expiresAt: r.expiresAt })
    }
    if (url.pathname === '/admin/auth/logout' && req.method === 'POST') {
      sessions.logout(bearerToken(req.headers.get('authorization')))
      return json({ ok: true })
    }
    if (isAdminPath && !isLlmAdmin) {
      if (!operator) return json({ error: { code: 'FORBIDDEN', message: 'Admin access required.' } }, 403)
      if (url.pathname === '/admin/session') return json({ kind: session ? 'wallet' : 'token', address: session?.address ?? null, expiresAt: session?.expiresAt ?? null })

      if (url.pathname === '/admin/platform/stats') {
        const idx = indexerDb()
        if (!idx) return json({ error: { code: 'INDEXER_DISABLED', message: 'Statistics come from the indexer. Set INDEXER_ENABLED=true and point INDEXER_NETWORK at the chain to measure.' } }, 503)
        const days = Math.min(90, Math.max(7, Math.floor(Number(url.searchParams.get('days'))) || 30))
        const topUsers = Math.min(1000, Math.max(10, Math.floor(Number(url.searchParams.get('users'))) || 100))
        const cacheKey = `${days}:${topUsers}`
        if (statsCache && statsCache.key === cacheKey && Date.now() - statsCache.at < 20_000) return json(statsCache.body)
        const usdc = getUsdc(idx.chainId)?.address
        if (!usdc) return json({ error: { code: 'NO_USDC', message: 'No USDC is known for the indexed chain.' } }, 500)
        const rows = await platformRows(idx.db, idx.chainId)
        const nowSec = Math.floor(Date.now() / 1000)
        const stats = computePlatformStats(rows.events, rows.swaps, { usdc, feeBps: platform.fee?.bps ?? null, nowSec, days, topUsers })
        const recipient = platform.fee?.recipient ?? null
        let balanceUnits: string | null = null
        if (recipient) {
          try {
            balanceUnits = (await publicClientFor(idx.chainId).readContract({ address: usdc as Address, abi: erc20Abi, functionName: 'balanceOf', args: [recipient as Address] })).toString()
          } catch {
            balanceUnits = null
          }
        }
        const body = {
          chainId: idx.chainId,
          generatedAt: nowSec,
          stats,
          fee: { bps: platform.fee?.bps ?? null, recipient, problem: platform.problem ?? null, balanceUnits },
          indexer: indexerStatus(),
        }
        statsCache = { key: cacheKey, at: Date.now(), body }
        return json(body)
      }

      if (url.pathname === '/admin/secrets' && req.method === 'GET') return json(secretStore.status())
      if (url.pathname.startsWith('/admin/secrets/')) {
        const name = decodeURIComponent(url.pathname.slice('/admin/secrets/'.length))
        if (!isSecretName(name)) return json({ error: { code: 'NOT_FOUND', message: 'Unknown key name.' } }, 404)
        if (!secretStore.enabled) return json({ error: { code: 'SECRETS_DISABLED', message: 'Set SECRETS_ENCRYPTION_KEY (at least 16 characters) on the server to save keys from the dashboard.' } }, 409)
        if (req.method === 'PUT') {
          let body: { value?: unknown } = {}
          try {
            body = (await req.json()) as typeof body
          } catch {
            return json({ error: { code: 'INPUT_INVALID', message: 'Body must be JSON.' } }, 400)
          }
          if (!validSecretValue(body.value)) return json({ error: { code: 'INPUT_INVALID', message: 'A key is 8 to 512 characters with no spaces.' } }, 400)
          secretStore.set(name, body.value)
          return json(secretStore.status())
        }
        if (req.method === 'DELETE') {
          secretStore.remove(name)
          return json(secretStore.status())
        }
      }
      return json({ error: { code: 'NOT_FOUND', message: 'Unknown route' } }, 404)
    }

    if (isLlmAdmin) {
      if (!operator) return json({ error: { code: 'FORBIDDEN', message: 'Operator access required.' } }, 403)
      if (url.pathname === '/admin/agent-llm' && req.method === 'GET') {
        return json({ config: llmStore.get(), providers: providerOverview(), usage: llmUsage.snapshot(), dailyBudgetLeft: chatBudget.remaining })
      }
      if (url.pathname === '/admin/agent-llm' && req.method === 'PUT') {
        let body: unknown
        try {
          body = await req.json()
        } catch {
          return json({ error: { code: 'INPUT_INVALID', message: 'Body must be JSON.' } }, 400)
        }
        const next = sanitizeLlmConfig(body)
        const asked = (body as { enabled?: unknown })?.enabled === true
        if (asked && !next.enabled) return json({ error: { code: 'INPUT_INVALID', message: 'Choose a valid provider and model for the first slot before switching the chat model on.' } }, 400)
        return json({ config: llmStore.set(next) })
      }
      if (url.pathname === '/admin/agent-llm/test' && req.method === 'POST') {
        let body: { provider?: unknown; model?: unknown } = {}
        try {
          body = (await req.json()) as typeof body
        } catch {
          return json({ error: { code: 'INPUT_INVALID', message: 'Body must be JSON.' } }, 400)
        }
        const one = sanitizeLlmConfig({ enabled: true, primary: { provider: body.provider, model: body.model } })
        if (!one.primary) return json({ error: { code: 'INPUT_INVALID', message: 'Unknown provider or invalid model name.' } }, 400)
        const probe = await runChain(one, { text: 'buy 5 dollars of bitcoin', tokens: ['tBTC', 'tETH'], quote: 'USDC' }, { timeoutMs: 15_000 })
        const a = probe.attempts[0]
        return json({ ok: Boolean(probe.out), ms: a?.ms ?? 0, error: probe.out ? null : (a?.error ?? 'no answer'), command: probe.out?.command ?? null })
      }
      if (url.pathname === '/admin/agent-llm/models' && req.method === 'GET') {
        const provider = url.searchParams.get('provider') as ProviderId | null
        if (provider !== 'openrouter') return json({ models: PROVIDERS.find((p) => p.id === provider)?.presets.map((p) => ({ id: p.model, name: p.label, perMillion: 0, free: false })) ?? [] })
        if (!openRouterModels || Date.now() - openRouterModels.at > 3_600_000) {
          try {
            const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(10_000) })
            if (!res.ok) throw new Error('model list unavailable')
            openRouterModels = { at: Date.now(), models: pickCheapModels(await res.json()) }
          } catch {
            if (!openRouterModels) return json({ error: { code: 'MODEL_LIST_UNAVAILABLE', message: 'OpenRouter did not answer. Type a model name instead.' } }, 502)
          }
        }
        return json({ models: openRouterModels.models })
      }
      return json({ error: { code: 'NOT_FOUND', message: 'Unknown route' } }, 404)
    }

    if (url.pathname === '/market/token' || url.pathname === '/market/candles') {
      const chainId = Number(url.searchParams.get('chainId'))
      const token = url.searchParams.get('token') ?? ''
      if (!Number.isInteger(chainId) || !/^0x[0-9a-fA-F]{40}$/.test(token)) return json({ error: { code: 'INPUT_INVALID', message: 'chainId and a token address are required' } }, 400)
      if (!dexData.supports(chainId)) return json({ market: null, reason: 'unsupported_chain' })
      try {
        if (url.pathname === '/market/token') {
          const pool = await dexData.pool(chainId, token)
          return json({ market: pool }, 200, { 'cache-control': 'public, max-age=15' })
        }
        const tf = url.searchParams.get('tf') ?? '1h'
        if (!TIMEFRAME_IDS.includes(tf as Timeframe)) return json({ error: { code: 'INPUT_INVALID', message: `tf must be one of ${TIMEFRAME_IDS.join(', ')}` } }, 400)
        const out = await dexData.candles(chainId, token, tf as Timeframe)
        if (!out) return json({ market: null, candles: [], reason: 'no_pool' })
        return json({ market: out.pool, candles: out.candles, stale: out.stale, source: 'geckoterminal' }, 200, { 'cache-control': 'public, max-age=10' })
      } catch {
        metrics.http.upstreamErrors += 1
        return json({ error: { code: 'MARKET_DATA_UNAVAILABLE', message: 'Chart data is temporarily unavailable.' } }, 502)
      }
    }

    if (url.pathname === '/tokens') {
      const chainId = Number(url.searchParams.get('chainId'))
      if (!Number.isInteger(chainId) || !tokenList.supports(chainId)) return json({ tokens: [] })
      try {
        return json({ tokens: await tokenList.get(chainId) }, 200, { 'cache-control': 'public, max-age=300' })
      } catch {
        metrics.http.upstreamErrors += 1
        return json({ error: { code: 'TOKEN_LIST_UNAVAILABLE', message: 'The token list is temporarily unavailable.' } }, 502)
      }
    }

    if (url.pathname === '/history' || url.pathname === '/swaps' || url.pathname === '/stats' || url.pathname === '/admin-events') {
      if (!originAllowed(req.headers.get('origin'), req.headers.get('referer'), allowedOrigins)) {
        return json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This origin may not use the history service.' } }, 403)
      }
      const idx = indexerDb()
      if (!idx) return json({ error: { code: 'INDEXER_DISABLED', message: 'The indexer is not running on this backend.' } }, 503)

      if (isSwapReport) {
        // Body is only a transaction hash; everything stored is re-derived from the chain.
        let body: { chainId?: unknown; hash?: unknown }
        try {
          body = (await req.json()) as { chainId?: unknown; hash?: unknown }
        } catch {
          return json({ error: { code: 'INPUT_INVALID', message: 'Body must be JSON: { "chainId": number, "hash": "0x..." }' } }, 400)
        }
        if (body.chainId !== idx.chainId) return json({ error: { code: 'CHAIN_NOT_INDEXED', message: `This backend indexes chain ${idx.chainId}.` } }, 400)
        if (typeof body.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(body.hash)) return json({ error: { code: 'INPUT_INVALID', message: 'hash must be a 32-byte hex string' } }, 400)
        const verdict = await recordSwap(idx.db, idx.reader, { chainId: idx.chainId, hash: body.hash as `0x${string}`, allowedTargets: swapTargetsFor(idx.chainId) })
        if (!verdict.ok) return json({ error: { code: verdict.code, message: verdict.message } }, verdict.code === 'NOT_FOUND' ? 404 : 422)
        return json({ recorded: true }, 201)
      }

      if (url.pathname === '/admin-events') {
        // Owner actions are public chain data; the admin page uses them to list tokens, routers and pending changes.
        return json({ events: await adminEventsFor(idx.db, { chainId: idx.chainId, limit: clampLimit(url.searchParams.get('limit'), 200, 500) }) })
      }
      if (url.pathname === '/stats') {
        return json({ chainId: idx.chainId, indexer: { cursor: indexerStatus().cursor, head: indexerStatus().head, lagBlocks: indexerStatus().lagBlocks }, events: await eventCounts(idx.db, idx.chainId), swaps: await swapCount(idx.db, idx.chainId) })
      }
      const owner = url.searchParams.get('owner')
      if (!validOwner(owner)) return json({ error: { code: 'INPUT_INVALID', message: 'owner must be an address' } }, 400)
      const limit = clampLimit(url.searchParams.get('limit'))
      if (url.pathname === '/swaps') return json({ swaps: await swapsFor(idx.db, { chainId: idx.chainId, owner, limit }) })
      const beforeRaw = url.searchParams.get('before')
      const before = beforeRaw && /^[0-9]{1,12}$/.test(beforeRaw) ? Number(beforeRaw) : undefined
      const events = await historyFor(idx.db, { chainId: idx.chainId, owner, limit, before })
      return json({ events, next: events.length === limit ? events[events.length - 1].blockNumber : null })
    }

    if (url.pathname === '/price' || url.pathname === '/quote') {
      if (!originAllowed(req.headers.get('origin'), req.headers.get('referer'), allowedOrigins)) {
        return json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'This origin may not use the quote service.' } }, 403)
      }
      const parsed = parseQuoteRequest(url.searchParams, (id) => gateway.supportsChain(id))
      if (isApiError(parsed)) return json({ error: { code: parsed.code, message: parsed.message } }, parsed.status)
      try {
        if (url.pathname === '/price') {
          // The price does not depend on who asks, so the cache key leaves the wallet out and every
          // user of the same pair and size shares one gateway round trip. The wallet's own allowance is
          // read separately and added to the response.
          const cacheKey = [parsed.chainId, parsed.sellToken, parsed.buyToken, parsed.sellAmount, parsed.slippageBps].join(':').toLowerCase()
          let fresh = false
          const shared = await priceCache.get(cacheKey, async () => {
            fresh = true
            return gateway.best('price', withFee({ ...parsed, taker: NEUTRAL_TAKER }))
          })
          if (fresh) metrics.http.cacheMisses += 1
          else metrics.http.cacheHits += 1
          const allowanceKey = ['a', parsed.chainId, parsed.taker, parsed.sellToken, (shared.body as { spender?: string })?.spender ?? ''].join(':').toLowerCase()
          const out = await allowanceCache.get(allowanceKey + ':' + cacheKey, () => withTakerAllowance(shared, parsed, readAllowance))
          return json(out.body, out.status, { 'x-cache': fresh ? 'miss' : 'hit' })
        }
        const out = await gateway.best('quote', withFee(parsed))
        return json(out.body, out.status)
      } catch {
        metrics.http.upstreamErrors += 1
        return json({ error: { code: 'UPSTREAM_UNREACHABLE', message: 'Could not reach the quote providers.' } }, 502)
      }
    }

    return json({ error: { code: 'NOT_FOUND', message: 'Unknown route' } }, 404)
  },
})

console.log(
  `[api] listening on :${server.port} (providers: ${gateway.status().map((p) => `${p.id}=${p.configured ? 'on' : 'no key'}`).join(', ')}, trusted proxy hops ${trustedHops}, ` +
    `origin gate ${allowedOrigins.length ? 'on' : 'off'}, operator auth ${adminToken ? 'token' : 'loopback only'})`,
)
if (!adminToken) console.warn('[api] ADMIN_TOKEN is not set: /metrics and detailed /health are limited to direct loopback requests. Set it in production.')
// Tell operators when a quote provider's breaker opens or closes.
setInterval(() => {
  for (const p of gateway.status()) {
    if (p.configured) void alerter.set(`gateway:${p.id}`, p.breaker === 'open', `quote provider ${p.id} is failing and has been taken out of rotation`)
  }
}, 15_000).unref()
void startIndexer()
startKeeper()
