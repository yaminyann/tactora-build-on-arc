/**
 * Wallet sign-in for platform admins.
 *
 * A platform admin is a wallet listed in PLATFORM_ADMIN_ADDRESSES. To get access the wallet signs a one-time message
 * (no transaction, no gas); the server checks the signature, then hands back a random session token that the browser
 * sends as `Authorization: Bearer ...`. ADMIN_TOKEN keeps working next to it as the break-glass key.
 *
 * Only plain wallets (EOAs: MetaMask, Rabby, a hardware wallet) can sign in. A smart-contract wallet, including the
 * passkey wallet, does not produce a signature that can be checked without an onchain call, so it is not accepted
 * here. That is deliberate: admin access should sit on a key you control and can store offline.
 *
 * Sessions live in memory: a restart signs everyone out, which is the safe direction.
 */
import { createHash, randomBytes } from 'node:crypto'
import { isAddress, recoverMessageAddress, type Hex } from 'viem'

export interface AdminAddresses {
  addresses: string[]
  problems: string[]
}

/** Parses the comma-separated list. Anything that is not a valid address is reported, never silently trusted. */
export function parseAdminAddresses(raw: string | undefined): AdminAddresses {
  const addresses: string[] = []
  const problems: string[] = []
  for (const part of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!isAddress(part, { strict: false })) {
      problems.push(`PLATFORM_ADMIN_ADDRESSES contains an invalid address: ${part.slice(0, 12)}...`)
      continue
    }
    const a = part.toLowerCase()
    if (!addresses.includes(a)) addresses.push(a)
  }
  return { addresses, problems }
}

export function challengeMessage(address: string, nonce: string, issuedAtMs: number): string {
  return [
    'Tactora platform admin sign-in',
    '',
    `This proves you control ${address}. It is not a transaction and costs nothing.`,
    '',
    `Nonce: ${nonce}`,
    `Issued: ${new Date(issuedAtMs).toISOString()}`,
  ].join('\n')
}

export type LoginResult =
  | { ok: true; token: string; address: string; expiresAt: number }
  | { ok: false; code: 'NOT_ADMIN' | 'CHALLENGE_INVALID' | 'SIGNATURE_INVALID'; message: string }

export type ChallengeResult = { ok: true; message: string; nonce: string } | { ok: false; code: 'NOT_ADMIN'; message: string }

interface Options {
  challengeTtlMs?: number
  sessionTtlMs?: number
  now?: () => number
  /** Replaceable so tests need no real signature. */
  recover?: (message: string, signature: Hex) => Promise<string>
}

const MAX_PENDING = 500
const MAX_SESSIONS = 200

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

export class AdminSessions {
  private readonly admins: Set<string>
  private readonly challenges = new Map<string, { address: string; message: string; expires: number }>()
  private readonly sessions = new Map<string, { address: string; expires: number }>()
  private readonly challengeTtl: number
  private readonly sessionTtl: number
  private readonly now: () => number
  private readonly recover: (message: string, signature: Hex) => Promise<string>

  constructor(admins: readonly string[], opts: Options = {}) {
    this.admins = new Set(admins.map((a) => a.toLowerCase()))
    this.challengeTtl = opts.challengeTtlMs ?? 5 * 60_000
    this.sessionTtl = opts.sessionTtlMs ?? 8 * 3_600_000
    this.now = opts.now ?? Date.now
    this.recover = opts.recover ?? ((message, signature) => recoverMessageAddress({ message, signature }))
  }

  get configured(): boolean {
    return this.admins.size > 0
  }

  isAdmin(address: string | null | undefined): boolean {
    return Boolean(address && this.admins.has(address.toLowerCase()))
  }

  private prune(): void {
    const t = this.now()
    for (const [k, v] of this.challenges) if (v.expires <= t) this.challenges.delete(k)
    for (const [k, v] of this.sessions) if (v.expires <= t) this.sessions.delete(k)
    // A flood of requests cannot grow memory without bound: the oldest entries go first.
    while (this.challenges.size > MAX_PENDING) this.challenges.delete(this.challenges.keys().next().value as string)
    while (this.sessions.size > MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value as string)
  }

  challenge(address: string): ChallengeResult {
    if (!this.isAdmin(address)) return { ok: false, code: 'NOT_ADMIN', message: 'This wallet is not a platform admin.' }
    this.prune()
    const nonce = randomBytes(16).toString('hex')
    const message = challengeMessage(address.toLowerCase(), nonce, this.now())
    this.challenges.set(nonce, { address: address.toLowerCase(), message, expires: this.now() + this.challengeTtl })
    return { ok: true, message, nonce }
  }

  /** A challenge works once: it is removed before the signature is checked, so a wrong guess burns it. */
  async login(address: string, nonce: string, signature: string): Promise<LoginResult> {
    const pending = this.challenges.get(nonce)
    this.challenges.delete(nonce)
    if (!pending || pending.expires <= this.now() || pending.address !== address.toLowerCase()) {
      return { ok: false, code: 'CHALLENGE_INVALID', message: 'The sign-in request expired. Start again.' }
    }
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return { ok: false, code: 'SIGNATURE_INVALID', message: 'That is not a wallet signature.' }
    let signer: string
    try {
      signer = (await this.recover(pending.message, signature as Hex)).toLowerCase()
    } catch {
      return { ok: false, code: 'SIGNATURE_INVALID', message: 'The signature could not be read.' }
    }
    if (signer !== pending.address || !this.isAdmin(signer)) return { ok: false, code: 'SIGNATURE_INVALID', message: 'The signature does not match this wallet.' }
    this.prune()
    const token = randomBytes(32).toString('hex')
    const expiresAt = this.now() + this.sessionTtl
    this.sessions.set(hashToken(token), { address: signer, expires: expiresAt })
    return { ok: true, token, address: signer, expiresAt }
  }

  verify(token: string | null | undefined): { address: string; expiresAt: number } | null {
    if (!token) return null
    const s = this.sessions.get(hashToken(token))
    if (!s) return null
    if (s.expires <= this.now()) {
      this.sessions.delete(hashToken(token))
      return null
    }
    // Removing an admin from the list takes effect at once, not at session expiry.
    if (!this.isAdmin(s.address)) return null
    return { address: s.address, expiresAt: s.expires }
  }

  logout(token: string | null | undefined): void {
    if (token) this.sessions.delete(hashToken(token))
  }
}

/** The token part of an `Authorization: Bearer` header, or null. */
export function bearerToken(authorization: string | null): string | null {
  return authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() || null : null
}
