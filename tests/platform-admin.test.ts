import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AdminSessions, bearerToken, parseAdminAddresses } from '../server/admin-auth'
import { SecretStore, SECRET_NAMES, validSecretValue } from '../server/secrets'
import { computePlatformStats, type EventLite, type SwapLite } from '../server/platform-stats'

const ADMIN = '0x378862A20B312298dc54585CbabC531D70F9baE9'
const OTHER = '0x1111111111111111111111111111111111111111'
const SIG = `0x${'ab'.repeat(65)}`

describe('admin addresses', () => {
  test('lowercases, de-duplicates and reports bad entries instead of trusting them', () => {
    const r = parseAdminAddresses(` ${ADMIN}, ${ADMIN.toLowerCase()}, 0xnope ,, ${OTHER}`)
    expect(r.addresses).toEqual([ADMIN.toLowerCase(), OTHER])
    expect(r.problems).toHaveLength(1)
    expect(parseAdminAddresses(undefined).addresses).toEqual([])
  })
})

describe('wallet sign-in', () => {
  const make = (signer: string, now = { t: 1_000_000 }) => ({
    now,
    s: new AdminSessions([ADMIN], { now: () => now.t, recover: () => Promise.resolve(signer) }),
  })

  test('a listed wallet signs a one-time message and gets a working session', async () => {
    const { s } = make(ADMIN)
    const c = s.challenge(ADMIN)
    if (!c.ok) throw new Error('no challenge')
    expect(c.message).toContain(c.nonce)
    const r = await s.login(ADMIN, c.nonce, SIG)
    if (!r.ok) throw new Error(r.message)
    expect(s.verify(r.token)?.address).toBe(ADMIN.toLowerCase())
    expect(s.verify('wrong')).toBeNull()
    s.logout(r.token)
    expect(s.verify(r.token)).toBeNull()
  })

  test('a wallet that is not listed gets no challenge', () => {
    const { s } = make(OTHER)
    expect(s.challenge(OTHER)).toMatchObject({ ok: false, code: 'NOT_ADMIN' })
    expect(s.isAdmin(OTHER)).toBe(false)
  })

  test('a signature from a different wallet is refused, and the challenge cannot be tried twice', async () => {
    const { s } = make(OTHER)
    const c = s.challenge(ADMIN)
    if (!c.ok) throw new Error('no challenge')
    expect(await s.login(ADMIN, c.nonce, SIG)).toMatchObject({ ok: false, code: 'SIGNATURE_INVALID' })
    expect(await s.login(ADMIN, c.nonce, SIG)).toMatchObject({ ok: false, code: 'CHALLENGE_INVALID' })
  })

  test('a challenge is bound to the address it was issued for and expires', async () => {
    const { s, now } = make(ADMIN)
    const c = s.challenge(ADMIN)
    if (!c.ok) throw new Error('no challenge')
    expect(await s.login(OTHER, c.nonce, SIG)).toMatchObject({ ok: false, code: 'CHALLENGE_INVALID' })
    const d = s.challenge(ADMIN)
    if (!d.ok) throw new Error('no challenge')
    now.t += 6 * 60_000
    expect(await s.login(ADMIN, d.nonce, SIG)).toMatchObject({ ok: false, code: 'CHALLENGE_INVALID' })
  })

  test('malformed signatures and recover failures are refused', async () => {
    const { s } = make(ADMIN)
    const c = s.challenge(ADMIN)
    if (!c.ok) throw new Error('no challenge')
    expect(await s.login(ADMIN, c.nonce, '0x1234')).toMatchObject({ ok: false, code: 'SIGNATURE_INVALID' })
    const bad = new AdminSessions([ADMIN], { recover: () => Promise.reject(new Error('bad')) })
    const c2 = bad.challenge(ADMIN)
    if (!c2.ok) throw new Error('no challenge')
    expect(await bad.login(ADMIN, c2.nonce, SIG)).toMatchObject({ ok: false, code: 'SIGNATURE_INVALID' })
  })

  test('sessions expire, and a real signature round trip works', async () => {
    const { s, now } = make(ADMIN)
    const c = s.challenge(ADMIN)
    if (!c.ok) throw new Error('no challenge')
    const r = await s.login(ADMIN, c.nonce, SIG)
    if (!r.ok) throw new Error(r.message)
    now.t += 9 * 3_600_000
    expect(s.verify(r.token)).toBeNull()

    // No injected recover: a signature from the real key must verify through viem.
    const { privateKeyToAccount } = await import('viem/accounts')
    const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
    const real = new AdminSessions([account.address])
    const ch = real.challenge(account.address)
    if (!ch.ok) throw new Error('no challenge')
    const sig = await account.signMessage({ message: ch.message })
    expect((await real.login(account.address, ch.nonce, sig)).ok).toBe(true)
    // The same message signed by another key does not.
    const other = privateKeyToAccount(`0x${'22'.repeat(32)}`)
    const ch2 = real.challenge(account.address)
    if (!ch2.ok) throw new Error('no challenge')
    expect(await real.login(account.address, ch2.nonce, await other.signMessage({ message: ch2.message }))).toMatchObject({ ok: false, code: 'SIGNATURE_INVALID' })
  })

  test('reads the bearer token from a header', () => {
    expect(bearerToken('Bearer abc')).toBe('abc')
    expect(bearerToken('Basic abc')).toBeNull()
    expect(bearerToken(null)).toBeNull()
    expect(bearerToken('Bearer ')).toBeNull()
  })
})

describe('saved API keys', () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-'))
  const KEY = 'a-long-enough-encryption-key'

  test('is off without an encryption key and writes nothing', () => {
    const file = path.join(dir(), 'secrets.json')
    const env: Record<string, string | undefined> = {}
    const store = new SecretStore(file, undefined, env)
    expect(store.enabled).toBe(false)
    expect(() => store.set('OPENAI_API_KEY', 'sk-0123456789')).toThrow()
    expect(fs.existsSync(file)).toBe(false)
    expect(new SecretStore(file, 'short', env).problem).toContain('16 characters')
  })

  test('encrypts on disk, applies to the environment, and survives a restart', () => {
    const file = path.join(dir(), 'secrets.json')
    const env: Record<string, string | undefined> = { OPENAI_API_KEY: 'from-env-0000' }
    const store = new SecretStore(file, KEY, env)
    store.set('OPENAI_API_KEY', 'sk-live-0123456789')
    expect(env.OPENAI_API_KEY).toBe('sk-live-0123456789')
    expect(fs.readFileSync(file, 'utf8')).not.toContain('sk-live-0123456789')
    const row = store.status().secrets.find((s) => s.name === 'OPENAI_API_KEY')
    expect(row).toMatchObject({ source: 'admin', hint: '6789' })
    expect(JSON.stringify(store.status())).not.toContain('sk-live-0123456789')

    const env2: Record<string, string | undefined> = {}
    new SecretStore(file, KEY, env2)
    expect(env2.OPENAI_API_KEY).toBe('sk-live-0123456789')
  })

  test('removing a saved key restores what the environment started with', () => {
    const env: Record<string, string | undefined> = { GEMINI_API_KEY: 'from-env-0000' }
    const store = new SecretStore(path.join(dir(), 's.json'), KEY, env)
    store.set('GEMINI_API_KEY', 'saved-key-12345')
    store.remove('GEMINI_API_KEY')
    expect(env.GEMINI_API_KEY).toBe('from-env-0000')
    expect(store.status().secrets.find((s) => s.name === 'GEMINI_API_KEY')).toMatchObject({ source: 'env', hint: null })
    const env2: Record<string, string | undefined> = {}
    const s2 = new SecretStore(path.join(dir(), 's2.json'), KEY, env2)
    s2.set('ZEROEX_API_KEY', 'zero-key-12345')
    s2.remove('ZEROEX_API_KEY')
    expect('ZEROEX_API_KEY' in env2).toBe(false)
  })

  test('a wrong encryption key keeps the environment values and reports it', () => {
    const file = path.join(dir(), 's.json')
    new SecretStore(file, KEY, {}).set('OPENAI_API_KEY', 'sk-live-0123456789')
    const env: Record<string, string | undefined> = { OPENAI_API_KEY: 'from-env-0000' }
    const bad = new SecretStore(file, 'another-long-enough-key-x', env)
    expect(bad.problem).toContain('decrypted')
    expect(env.OPENAI_API_KEY).toBe('from-env-0000')
  })

  test('rejects values that are too short, too long or contain spaces', () => {
    expect(validSecretValue('short')).toBe(false)
    expect(validSecretValue('has a space 123')).toBe(false)
    expect(validSecretValue('x'.repeat(600))).toBe(false)
    expect(validSecretValue('line\nbreak-12345')).toBe(false)
    expect(validSecretValue('good-key-12345')).toBe(true)
    expect(SECRET_NAMES).toContain('ZEROEX_API_KEY')
  })
})

describe('platform statistics', () => {
  const USDC = '0x3600000000000000000000000000000000000000'
  const TOKEN = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const NOW = 1_800_000_000
  const ev = (name: string, owner: string | null, itemId: string | null, blockTime: number, args: Record<string, unknown>): EventLite => ({ name, owner, itemId, blockTime, txHash: `0x${name}${itemId ?? ''}`, args })
  const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1'

  const events: EventLite[] = [
    ev('OrderCreated', A, '1', NOW - 3600, { params: { side: 0, orderType: 0 } }), // buy limit
    ev('OrderCreated', A, '2', NOW - 3500, { params: { side: 1, orderType: 1 } }), // sell stop loss
    ev('OrderExecuted', A, '1', NOW - 3000, { amountIn: '10000000', net: '99', keeperFee: '1' }), // buy: 10 USDC spent
    ev('OrderExecuted', A, '2', NOW - 2900, { amountIn: '500', net: '19980000', keeperFee: '20000' }), // sell: 20 USDC received
    ev('OrderCreated', B, '3', NOW - 2800, { params: { side: 0, orderType: 5 } }),
    ev('OrderCancelled', B, '3', NOW - 2700, { refund: '1' }),
    ev('DcaCreated', B, '1', NOW - 2600, {}),
    ev('DcaExecuted', B, '1', NOW - 2500, { amountIn: '5000000', net: '4', keeperFee: '1' }),
  ]
  const swaps: SwapLite[] = [
    { owner: B, txHash: '0xs1', sellToken: USDC, sellAmount: '100000000', buyToken: TOKEN, buyAmount: '7', blockTime: NOW - 2000 }, // sold 100 USDC
    { owner: A, txHash: '0xs2', sellToken: TOKEN, sellAmount: '9', buyToken: USDC, buyAmount: '40000000', blockTime: NOW - 1900 }, // bought 40 USDC
    { owner: A, txHash: '0xs3', sellToken: TOKEN, sellAmount: '9', buyToken: '0xcccccccccccccccccccccccccccccccccccccccc', buyAmount: '3', blockTime: NOW - 1800 }, // no USDC leg
  ]
  const stats = computePlatformStats(events, swaps, { usdc: USDC, feeBps: 30, nowSec: NOW, days: 7, topUsers: 10 })

  test('counts users and orders', () => {
    expect(stats.users.total).toBe(2)
    expect(stats.orders).toMatchObject({ created: 3, filled: 2, cancelled: 1, expired: 0, open: 0 })
    expect(stats.orders.byType).toEqual({ Limit: 1, 'Stop loss': 1, OCO: 1 })
    expect(stats.dca).toMatchObject({ plans: 1, runs: 1, active: 1 })
  })

  test('values only the USDC leg of each trade', () => {
    expect(stats.volumeUnits.orders).toBe((10_000_000n + 19_980_000n + 20_000n).toString())
    expect(stats.volumeUnits.dca).toBe('5000000')
    expect(stats.volumeUnits.swaps).toBe((100_000_000n + 40_000_000n).toString())
    expect(stats.swaps).toEqual({ count: 3, valued: 2 })
    expect(BigInt(stats.volumeUnits.total)).toBe(BigInt(stats.volumeUnits.orders) + BigInt(stats.volumeUnits.dca) + BigInt(stats.volumeUnits.swaps))
  })

  test('estimates the swap fee only where USDC was sold, and says what it could not value', () => {
    expect(stats.fees.swapFeeEstimateUnits).toBe(((100_000_000n * 30n) / 10_000n).toString())
    expect(stats.fees.swapsFeeNotValued).toBe(2)
    expect(stats.fees.keeperFeeUsdcUnits).toBe('20000')
    expect(stats.fees.keeperFeeOtherTokenCount).toBe(2)
    const off = computePlatformStats(events, swaps, { usdc: USDC, feeBps: null, nowSec: NOW, days: 7, topUsers: 10 })
    expect(off.fees.swapFeeEstimateUnits).toBe('0')
  })

  test('ranks users by volume and fills every day of the window', () => {
    expect(stats.topUsers[0].address).toBe(B)
    expect(stats.topUsers[0].volumeUnits).toBe((5_000_000n + 100_000_000n).toString())
    expect(stats.days).toHaveLength(7)
    expect(stats.days.reduce((n, d) => n + BigInt(d.totalUnits), 0n)).toBe(BigInt(stats.volumeUnits.total))
    expect(stats.recent[0].time).toBeGreaterThanOrEqual(stats.recent[stats.recent.length - 1].time)
  })

  test('survives an empty index and malformed amounts', () => {
    const empty = computePlatformStats([], [], { usdc: USDC, feeBps: null, nowSec: NOW, days: 7, topUsers: 10 })
    expect(empty.users.total).toBe(0)
    expect(empty.volumeUnits.total).toBe('0')
    const junk = computePlatformStats([ev('DcaExecuted', A, '9', NOW, { amountIn: 'not a number' })], [], { usdc: USDC, feeBps: null, nowSec: NOW, days: 7, topUsers: 10 })
    expect(junk.volumeUnits.dca).toBe('0')
  })
})
