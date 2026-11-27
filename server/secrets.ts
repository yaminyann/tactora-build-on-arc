/**
 * API keys that an admin can set from the platform dashboard instead of editing the server environment.
 *
 * Stored encrypted (AES-256-GCM, key derived from SECRETS_ENCRYPTION_KEY) in DATA_DIR/secrets.json with owner-only file
 * permissions. Without SECRETS_ENCRYPTION_KEY the feature is off and the dashboard says so: nothing is ever written
 * in plain text. A saved key is copied into process.env, so every part of the server that already reads the environment
 * (the chat model, the 0x provider) uses it immediately; removing it restores the value the environment started with.
 *
 * Keys are never returned by any route. The dashboard can only learn whether one is set and its last four characters.
 *
 * Not settable here: the Circle Client Key (VITE_CIRCLE_CLIENT_KEY) is compiled into the web build and needs a rebuild.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const SECRET_NAMES = ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'AGENT_LLM_API_KEY', 'ZEROEX_API_KEY'] as const
export type SecretName = (typeof SECRET_NAMES)[number]

export const SECRET_INFO: Record<SecretName, { label: string; use: string; where: string }> = {
  OPENROUTER_API_KEY: { label: 'OpenRouter', use: 'Agent chat model (many models, some free)', where: 'https://openrouter.ai/keys' },
  GEMINI_API_KEY: { label: 'Google Gemini', use: 'Agent chat model (free tier)', where: 'https://aistudio.google.com/apikey' },
  OPENAI_API_KEY: { label: 'OpenAI', use: 'Agent chat model (paid)', where: 'https://platform.openai.com/api-keys' },
  AGENT_LLM_API_KEY: { label: 'Custom model key', use: 'Key for the custom OpenAI-compatible endpoint', where: 'Your own provider' },
  ZEROEX_API_KEY: { label: '0x Swap API', use: 'Extra swap quotes on Arc mainnet', where: 'https://dashboard.0x.org' },
}

export const isSecretName = (n: string): n is SecretName => (SECRET_NAMES as readonly string[]).includes(n)

type Env = Record<string, string | undefined>

interface Sealed {
  iv: string
  tag: string
  data: string
}

export interface SecretStatus {
  name: SecretName
  label: string
  use: string
  where: string
  source: 'admin' | 'env' | 'none'
  /** Last four characters of a key saved here. Never present for a key from the environment. */
  hint: string | null
}

export function validSecretValue(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 8 && v.length <= 512 && !/[\s\u0000-\u001f\u007f]/.test(v)
}

export class SecretStore {
  private readonly key: Buffer | null
  private readonly original = new Map<SecretName, string | undefined>()
  private items = new Map<SecretName, string>()
  problem: string | null = null

  constructor(
    private readonly file: string,
    encryptionKey: string | undefined,
    private readonly env: Env = process.env,
  ) {
    this.key = encryptionKey && encryptionKey.length >= 16 ? scryptSync(encryptionKey, 'lumarc-secrets-v1', 32) : null
    if (encryptionKey && !this.key) this.problem = 'SECRETS_ENCRYPTION_KEY must be at least 16 characters. Saving keys from the dashboard is off.'
    for (const n of SECRET_NAMES) this.original.set(n, env[n])
    if (this.key) this.load()
  }

  get enabled(): boolean {
    return this.key !== null
  }

  private seal(plain: string): Sealed {
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', this.key as Buffer, iv)
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
    return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }
  }

  private open(s: Sealed): string {
    const d = createDecipheriv('aes-256-gcm', this.key as Buffer, Buffer.from(s.iv, 'base64'))
    d.setAuthTag(Buffer.from(s.tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(s.data, 'base64')), d.final()]).toString('utf8')
  }

  private load(): void {
    let raw: string
    try {
      raw = fs.readFileSync(this.file, 'utf8')
    } catch {
      return
    }
    try {
      const parsed = JSON.parse(raw) as { items?: Record<string, Sealed> }
      for (const [name, sealed] of Object.entries(parsed.items ?? {})) {
        if (!isSecretName(name)) continue
        const value = this.open(sealed)
        this.items.set(name, value)
        this.env[name] = value
      }
    } catch {
      // A wrong encryption key or a damaged file: keep using the environment and tell the admin.
      this.problem = 'Saved keys could not be decrypted. Check SECRETS_ENCRYPTION_KEY, or save the keys again.'
    }
  }

  private persist(): void {
    const items: Record<string, Sealed> = {}
    for (const [n, v] of this.items) items[n] = this.seal(v)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, items }), { mode: 0o600 })
    fs.renameSync(tmp, this.file)
  }

  set(name: SecretName, value: string): void {
    if (!this.key) throw new Error('SECRETS_ENCRYPTION_KEY is not set')
    this.items.set(name, value)
    this.persist()
    this.env[name] = value
    this.problem = null
  }

  remove(name: SecretName): void {
    if (!this.key) throw new Error('SECRETS_ENCRYPTION_KEY is not set')
    this.items.delete(name)
    this.persist()
    const orig = this.original.get(name)
    if (orig === undefined) delete this.env[name]
    else this.env[name] = orig
  }

  status(): { enabled: boolean; problem: string | null; secrets: SecretStatus[] } {
    return {
      enabled: this.enabled,
      problem: this.problem,
      secrets: SECRET_NAMES.map((name) => {
        const mine = this.items.get(name)
        const source = mine ? 'admin' : this.original.get(name) ? 'env' : 'none'
        return { name, ...SECRET_INFO[name], source, hint: mine ? mine.slice(-4) : null }
      }),
    }
  }
}
