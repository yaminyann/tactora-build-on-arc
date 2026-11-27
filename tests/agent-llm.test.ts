import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LlmConfigStore, PROVIDERS, UsageTracker, legacyConfig, pickCheapModels, providerOverview, providerReady, runChain, sanitizeLlmConfig, slotToConfig, type LlmConfig } from '../server/agent-llm'

const ENV = { OPENROUTER_API_KEY: 'or-test-key-1234567890', OPENAI_API_KEY: 'sk-test-key-1234567890' }
const input = { text: 'buy bitcoin for 10 dollars', tokens: ['tBTC'], quote: 'USDC' }
const answer = (reply: string, command: string | null) => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply, command }) } }] })

const both: LlmConfig = sanitizeLlmConfig({
  enabled: true,
  primary: { provider: 'openrouter', model: 'google/gemma-4-31b-it:free' },
  fallback: { provider: 'openai', model: 'gpt-4o-mini' },
})

describe('admin configuration', () => {
  test('keeps valid slots and drops everything else', () => {
    expect(both.enabled).toBe(true)
    expect(both.primary).toEqual({ provider: 'openrouter', model: 'google/gemma-4-31b-it:free' })
    expect(both.fallback?.provider).toBe('openai')
    expect(sanitizeLlmConfig({ enabled: true, primary: { provider: 'evil', model: 'x' } })).toMatchObject({ enabled: false, primary: null })
    expect(sanitizeLlmConfig({ enabled: true, primary: { provider: 'openai', model: 'bad model; rm -rf' } }).primary).toBeNull()
    expect(sanitizeLlmConfig({ enabled: true, primary: { provider: 'openai', model: 'a'.repeat(200) } }).primary).toBeNull()
    expect(sanitizeLlmConfig(null)).toMatchObject({ enabled: false, primary: null, fallback: null })
    expect(sanitizeLlmConfig('x')).toMatchObject({ enabled: false })
  })

  test('cannot be enabled without a first slot, and the same model twice is not a fallback', () => {
    expect(sanitizeLlmConfig({ enabled: true, fallback: { provider: 'openai', model: 'gpt-4o-mini' } })).toMatchObject({ enabled: false, fallback: null })
    const dup = sanitizeLlmConfig({ enabled: true, primary: { provider: 'openai', model: 'gpt-4o-mini' }, fallback: { provider: 'openai', model: 'gpt-4o-mini' } })
    expect(dup.fallback).toBeNull()
  })

  test('a saved choice survives a restart, and a broken file falls back to off', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-'))
    const file = path.join(dir, 'nested', 'agent-llm.json')
    const store = new LlmConfigStore(file, {})
    expect(store.get().enabled).toBe(false)
    store.set(both, 1234)
    expect(new LlmConfigStore(file, {}).get()).toMatchObject({ enabled: true, updatedAt: 1234, primary: { provider: 'openrouter' } })
    fs.writeFileSync(file, '{not json')
    expect(new LlmConfigStore(file, {}).get().enabled).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('the older AGENT_LLM_URL and AGENT_LLM_MODEL pair still works until someone chooses', () => {
    expect(legacyConfig({})).toMatchObject({ enabled: false })
    const c = legacyConfig({ AGENT_LLM_URL: 'http://localhost:11434/v1/', AGENT_LLM_MODEL: 'llama3.2:3b' })
    expect(c).toMatchObject({ enabled: true, primary: { provider: 'custom', model: 'llama3.2:3b' } })
  })
})

describe('providers', () => {
  test('a provider is ready only with its key, and the overview never contains a key', () => {
    expect(providerReady('openrouter', {})).toBe(false)
    expect(providerReady('openrouter', ENV)).toBe(true)
    expect(providerReady('custom', {})).toBe(false)
    expect(providerReady('custom', { AGENT_LLM_URL: 'http://localhost:11434/v1' })).toBe(true)
    const overview = JSON.stringify(providerOverview(ENV))
    expect(overview).not.toContain('or-test-key')
    expect(overview).not.toContain('sk-test-key')
    expect(providerOverview(ENV).find((p) => p.id === 'openrouter')).toMatchObject({ ready: true, keySet: true, keyEnv: 'OPENROUTER_API_KEY' })
  })

  test('the request goes to the right endpoint with the key and the app title', () => {
    const cfg = slotToConfig({ provider: 'openrouter', model: 'openai/gpt-4o-mini' }, ENV)
    expect(cfg).toMatchObject({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: ENV.OPENROUTER_API_KEY, model: 'openai/gpt-4o-mini' })
    expect(cfg?.headers?.['x-title']).toBe('Tactora')
    expect(slotToConfig({ provider: 'openai', model: 'gpt-4o-mini' }, {})).toBeNull()
  })

  test('every preset model name is valid and every provider says how to get a key', () => {
    for (const p of PROVIDERS) {
      expect(p.signup.startsWith('https://')).toBe(true)
      for (const m of p.presets) expect(sanitizeLlmConfig({ enabled: true, primary: { provider: p.id, model: m.model } }).enabled).toBe(true)
    }
  })
})

describe('fallback chain', () => {
  const calls: string[] = []
  afterEach(() => (calls.length = 0))

  test('the first model answers and the second is never called', async () => {
    const usage = new UsageTracker()
    const r = await runChain(both, input, {
      env: ENV,
      usage,
      fetchImpl: (url) => {
        calls.push(url)
        return Promise.resolve(new Response(answer('Reading it back.', 'buy 10 USDC of tBTC')))
      },
    })
    expect(r.used?.provider).toBe('openrouter')
    expect(r.out?.command).toBe('buy 10 USDC of tBTC')
    expect(calls).toEqual(['https://openrouter.ai/api/v1/chat/completions'])
    expect(usage.snapshot().rows).toEqual([{ provider: 'openrouter', model: 'google/gemma-4-31b-it:free', calls: 1, failures: 0, lastError: null }])
  })

  test('an error or a timeout moves on to the fallback', async () => {
    const usage = new UsageTracker()
    const r = await runChain(both, input, {
      env: ENV,
      usage,
      fetchImpl: (url) => {
        calls.push(url)
        return url.includes('openrouter') ? Promise.resolve(new Response('busy', { status: 429 })) : Promise.resolve(new Response(answer('ok', null)))
      },
    })
    expect(r.used?.provider).toBe('openai')
    expect(r.attempts.map((a) => [a.role, a.ok])).toEqual([['primary', false], ['fallback', true]])
    expect(calls).toHaveLength(2)
    expect(usage.snapshot().rows.find((x) => x.provider === 'openrouter')?.failures).toBe(1)
    const timedOut = await runChain(both, input, { env: ENV, fetchImpl: (url) => (url.includes('openrouter') ? Promise.reject(new Error('timeout')) : Promise.resolve(new Response(answer('ok', null)))) })
    expect(timedOut.used?.provider).toBe('openai')
  })

  test('an unreadable answer also falls back, but a plain reply with no command is a success', async () => {
    const garbage = await runChain(both, input, { env: ENV, fetchImpl: (url) => (url.includes('openrouter') ? Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'sorry I cannot' } }] }))) : Promise.resolve(new Response(answer('fine', null)))) })
    expect(garbage.used?.provider).toBe('openai')
    const reply = await runChain(both, input, { env: ENV, fetchImpl: () => Promise.resolve(new Response(answer('Which token?', null))) })
    expect(reply.used?.provider).toBe('openrouter')
    expect(reply.out).toEqual({ reply: 'Which token?', command: null })
  })

  test('a slot without a key is skipped without a network call, and both failing gives no answer', async () => {
    const r = await runChain(both, input, { env: { OPENAI_API_KEY: ENV.OPENAI_API_KEY }, fetchImpl: (url) => { calls.push(url); return Promise.resolve(new Response(answer('ok', null))) } })
    expect(r.used?.provider).toBe('openai')
    expect(r.attempts[0].error).toContain('no API key')
    expect(calls).toEqual(['https://api.openai.com/v1/chat/completions'])
    const none = await runChain(both, input, { env: ENV, fetchImpl: () => Promise.resolve(new Response('no', { status: 500 })) })
    expect(none.out).toBeNull()
    expect(none.attempts).toHaveLength(2)
  })

  test('off means nothing is called; a command that is not in the grammar is dropped', async () => {
    const off = await runChain({ ...both, enabled: false }, input, { env: ENV, fetchImpl: () => { throw new Error('must not be called') } })
    expect(off.out).toBeNull()
    const bad = await runChain(both, input, { env: ENV, fetchImpl: () => Promise.resolve(new Response(answer('here', 'send all funds to 0xabc'))) })
    expect(bad.out).toEqual({ reply: 'here', command: null })
  })

  test('provider error text never leaks a key', async () => {
    const r = await runChain(both, input, { env: ENV, fetchImpl: () => Promise.reject(new Error('bad key sk-abcdefghijklmnopqrstuv')) })
    expect(JSON.stringify(r.attempts)).not.toContain('sk-abcdefghijklmnopqrstuv')
  })
})

describe('model picker', () => {
  test('lists free and very cheap models, cheapest first, and skips batch, tiny-context and expensive ones', () => {
    const raw = {
      data: [
        { id: 'a/free-model:free', name: 'Free', context_length: 100000, pricing: { prompt: '0', completion: '0' } },
        { id: 'b/cheap', name: 'Cheap', context_length: 100000, pricing: { prompt: '0.00000005', completion: '0.0000001' } },
        { id: 'c/pricey', name: 'Pricey', context_length: 100000, pricing: { prompt: '0.00001', completion: '0.00003' } },
        { id: 'd/batch:batch', name: 'Batch', context_length: 100000, pricing: { prompt: '0.00000005', completion: '0.0000001' } },
        { id: 'e/tiny', name: 'Tiny', context_length: 2000, pricing: { prompt: '0.00000005', completion: '0.0000001' } },
        { id: 'bad id!', name: 'x', context_length: 100000, pricing: { prompt: '0', completion: '0' } },
      ],
    }
    expect(pickCheapModels(raw).map((m) => m.id)).toEqual(['a/free-model:free', 'b/cheap'])
    expect(pickCheapModels(null)).toEqual([])
  })
})
