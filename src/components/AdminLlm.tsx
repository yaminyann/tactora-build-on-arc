import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { Badge, Button, Notice, Panel, Skeleton, Switch } from './ui'

/** The shapes the backend returns from /admin/agent-llm. */
type ProviderId = 'openrouter' | 'openai' | 'gemini' | 'custom'
interface Slot {
  provider: ProviderId
  model: string
}
interface LlmConfig {
  enabled: boolean
  primary: Slot | null
  fallback: Slot | null
  updatedAt: number
}
interface ProviderInfo {
  id: ProviderId
  label: string
  ready: boolean
  keyEnv: string
  keyless: boolean
  keySet: boolean
  endpointSet: boolean
  signup: string
  note: string
  presets: { model: string; label: string; cost: string }[]
}
interface LlmState {
  config: LlmConfig
  providers: ProviderInfo[]
  usage: { day: string; rows: { provider: ProviderId; model: string; calls: number; failures: number; lastError: string | null }[] }
  dailyBudgetLeft: number
}
interface ModelChoice {
  id: string
  name: string
  perMillion: number
  free: boolean
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T
  if (!res.ok) throw new Error(body.error?.message ?? `Request failed (${res.status})`)
  return body
}

const EMPTY_SLOT: Slot = { provider: 'openrouter', model: '' }

/** One provider + model choice. The model is picked from a short list of cheap or free ones, or typed by hand. */
function SlotEditor({ title, hint, slot, onChange, providers, token, optional }: { title: string; hint: string; slot: Slot | null; onChange: (s: Slot | null) => void; providers: ProviderInfo[]; token: string; optional?: boolean }) {
  const active = slot ?? EMPTY_SLOT
  const info = providers.find((p) => p.id === active.provider)
  const [custom, setCustom] = useState(false)
  const models = useQuery({
    queryKey: ['admin-llm-models', active.provider, token],
    enabled: Boolean(slot) && Boolean(token),
    staleTime: 3_600_000,
    retry: false,
    queryFn: () => call<{ models: ModelChoice[] }>(token, `/admin/agent-llm/models?provider=${active.provider}`).then((r) => r.models),
  })
  const test = useMutation({ mutationFn: () => call<{ ok: boolean; ms: number; error: string | null; command: string | null }>(token, '/admin/agent-llm/test', { method: 'POST', body: JSON.stringify(active) }) })
  const presets = info?.presets.map((p) => ({ id: p.model, name: p.label, perMillion: 0, free: p.cost.startsWith('Free') })) ?? []
  const list = [...presets, ...(models.data ?? []).filter((m) => !presets.some((p) => p.id === m.id))]
  const known = list.some((m) => m.id === active.model)

  return (
    <div className="border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base">{title}</h3>
          <p className="text-xs text-mute">{hint}</p>
        </div>
        {optional && (
          <Switch
            checked={Boolean(slot)}
            onChange={(on) => onChange(on ? { ...EMPTY_SLOT, model: info?.presets[0]?.model ?? '' } : null)}
            label="Use"
          />
        )}
      </div>

      {slot && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold">
              Provider
              <select
                value={active.provider}
                onChange={(e) => {
                  const p = providers.find((x) => x.id === e.target.value)
                  onChange({ provider: e.target.value as ProviderId, model: p?.presets[0]?.model ?? '' })
                  setCustom(false)
                }}
                className="mt-1 min-h-[44px] w-full border border-line bg-panel px-2 text-sm font-normal"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.ready ? '' : ' (no key)'}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold">
              Model
              {custom || (!known && active.model) ? (
                <input value={active.model} onChange={(e) => onChange({ ...active, model: e.target.value })} placeholder="provider/model-name" className="num mt-1 min-h-[44px] w-full border border-line bg-panel px-2 text-sm font-normal" />
              ) : (
                <select value={active.model} onChange={(e) => (e.target.value === '__custom' ? setCustom(true) : onChange({ ...active, model: e.target.value }))} className="mt-1 min-h-[44px] w-full border border-line bg-panel px-2 text-sm font-normal">
                  {list.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.free ? ' (free)' : m.perMillion > 0 ? ` ($${m.perMillion}/M)` : ''}
                    </option>
                  ))}
                  <option value="__custom">Type a model name...</option>
                </select>
              )}
            </label>
          </div>

          {info && !info.ready && (
            <Notice tone="warn" title={`${info.label} is not ready on this server`}>
              {info.keyless ? 'Set AGENT_LLM_URL in the backend environment.' : `Add ${info.keyEnv} to the backend environment (.env) and restart the API.`}{' '}
              <a className="inline-flex items-center gap-1 underline" href={info.signup} target="_blank" rel="noopener noreferrer">
                Get a key <ExternalLink className="h-3 w-3" />
              </a>
            </Notice>
          )}
          {info && <p className="text-xs text-mute">{info.note}</p>}
          {info?.presets.find((p) => p.model === active.model)?.cost && <p className="text-xs text-mute">Cost: {info.presets.find((p) => p.model === active.model)?.cost}.</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" className="min-h-[40px]" disabled={!active.model || test.isPending} loading={test.isPending} onClick={() => test.mutate()}>
              Test this model
            </Button>
            {test.data && (
              <span className="text-xs" role="status">
                {test.data.ok ? <Badge tone="up">Answered in {test.data.ms} ms</Badge> : <Badge tone="down">Failed</Badge>} {test.data.error ?? (test.data.command ? `Read "buy 5 dollars of bitcoin" as: ${test.data.command}` : 'Answered without a command (fine).')}
              </span>
            )}
            {test.isError && <span className="text-xs text-down">{test.error instanceof Error ? test.error.message : 'Test failed'}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Admin choice of the Agent's chat model. The admin picks a first model and, optionally, a second one that answers
 * when the first fails. API keys stay in the backend .env: this page only shows whether each key is present.
 */
export function AdminLlmSection({ token }: { token: string }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin-llm', token], enabled: Boolean(token), refetchInterval: 20_000, retry: false, queryFn: () => call<LlmState>(token, '/admin/agent-llm') })
  // What the admin has changed but not saved. Until they change something, the form shows what the server has.
  const [edit, setDraft] = useState<LlmConfig | null>(null)
  const draft = edit ?? q.data?.config ?? null
  const save = useMutation({
    mutationFn: (c: LlmConfig) => call<{ config: LlmConfig }>(token, '/admin/agent-llm', { method: 'PUT', body: JSON.stringify(c) }),
    onSuccess: () => {
      setDraft(null)
      void qc.invalidateQueries({ queryKey: ['admin-llm'] })
      void qc.invalidateQueries({ queryKey: ['backend-health'] })
    },
  })

  const dirty = q.data && draft && JSON.stringify({ ...draft, updatedAt: 0 }) !== JSON.stringify({ ...q.data.config, updatedAt: 0 })
  const state = q.data

  return (
    <Panel className="p-4">
      <h2 className="text-lg">Agent chat model</h2>
      <p className="mb-3 mt-0.5 text-xs text-mute">
        The Agent reads plain wording with free built-in rules first. Only what the rules cannot read goes to a model, so cost stays very low. Pick the model that answers, and optionally a second one that takes over if the first fails. A model can only suggest one command from the fixed grammar; you still read it back, say yes and sign.
      </p>

      {!token ? (
        <Notice title="Enter the admin token above">The chat model settings are protected by the same ADMIN_TOKEN as backend status.</Notice>
      ) : q.isError ? (
        <Notice tone="warn" title="Could not load the chat model settings">
          {q.error instanceof Error ? q.error.message : 'The backend did not answer.'}
        </Notice>
      ) : !state || !draft ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-raised p-3">
            <div>
              <div className="text-sm font-bold">{draft.enabled ? (draft.fallback ? 'On, with a fallback model' : 'On, one model') : 'Off'}</div>
              <div className="text-xs text-mute">{draft.enabled ? 'Wording the built-in rules cannot read is sent to the model below.' : 'The Agent uses only its built-in rules. Nothing is sent to any model.'}</div>
            </div>
            <Switch checked={draft.enabled} onChange={(on) => setDraft({ ...draft, enabled: on, primary: draft.primary ?? { provider: 'openrouter', model: state.providers.find((p) => p.id === 'openrouter')?.presets[0]?.model ?? '' } })} label="Chat model" />
          </div>

          {draft.enabled && (
            <div className="grid gap-3 lg:grid-cols-2">
              <SlotEditor title="First choice" hint="Answers every message that needs a model." slot={draft.primary} onChange={(s) => setDraft({ ...draft, primary: s ?? draft.primary })} providers={state.providers} token={token} />
              <SlotEditor title="Fallback" hint="Used only when the first choice errors, times out or cannot be read." slot={draft.fallback} onChange={(s) => setDraft({ ...draft, fallback: s })} providers={state.providers} token={token} optional />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={!dirty || save.isPending} loading={save.isPending} onClick={() => save.mutate(draft)}>
              Save choice
            </Button>
            {dirty && <span className="text-xs text-mute">Unsaved changes</span>}
            {save.isError && <span className="text-xs font-semibold text-down">{save.error instanceof Error ? save.error.message : 'Could not save'}</span>}
            {save.isSuccess && !dirty && <span className="text-xs font-semibold text-up">Saved. It applies to the next chat message.</span>}
          </div>

          <div>
            <h3 className="mb-1 text-sm font-bold">Keys on this server</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {state.providers.map((p) => (
                <div key={p.id} className="border border-line p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{p.label}</span>
                    <Badge tone={p.ready ? 'up' : 'mute'}>{p.ready ? 'Ready' : p.keyless ? 'No URL' : 'No key'}</Badge>
                  </div>
                  <div className="num mt-1 text-mute">{p.keyEnv}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-1 text-sm font-bold">Today ({state.usage.day})</h3>
            {state.usage.rows.length === 0 ? (
              <p className="text-xs text-mute">No model calls yet today.</p>
            ) : (
              <ul className="divide-y divide-line border border-line text-xs">
                {state.usage.rows.map((r) => (
                  <li key={`${r.provider}:${r.model}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="num">
                      {r.provider} / {r.model}
                    </span>
                    <span>
                      {r.calls} calls, {r.failures} failed{r.lastError ? `, last error: ${r.lastError}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-mute">Daily call limit left: {state.dailyBudgetLeft}. Change it with AGENT_LLM_DAILY_CALLS.</p>
          </div>
        </div>
      )}
    </Panel>
  )
}
