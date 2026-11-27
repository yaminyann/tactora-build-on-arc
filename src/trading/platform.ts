/**
 * Client side of the platform dashboard: the admin credential for this tab, typed backend calls, and the check that
 * decides whether to offer the Platform link. The server decides who is an admin; nothing here grants access.
 */
import { useCallback, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'

/** Shared with the contract Admin page, so signing in once serves both. */
export const ADMIN_CREDENTIAL_KEY = 'arc-terminal-admin-token'
const CHANGE = 'lumarc-admin-credential'

export function getAdminCredential(): string {
  try {
    return sessionStorage.getItem(ADMIN_CREDENTIAL_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setAdminCredential(value: string): void {
  try {
    if (value) sessionStorage.setItem(ADMIN_CREDENTIAL_KEY, value)
    else sessionStorage.removeItem(ADMIN_CREDENTIAL_KEY)
  } catch {
    // Storage can be blocked: the page simply asks again.
  }
  window.dispatchEvent(new Event(CHANGE))
}

const subscribe = (cb: () => void) => {
  window.addEventListener(CHANGE, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(CHANGE, cb)
    window.removeEventListener('storage', cb)
  }
}

/** The bearer credential for this tab (a wallet session token or the operator's ADMIN_TOKEN) and a way to change it. */
export function useAdminCredential(): [string, (v: string) => void] {
  const value = useSyncExternalStore(subscribe, getAdminCredential, () => '')
  return [value, useCallback((v: string) => setAdminCredential(v), [])]
}

export async function adminCall<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }
  const res = await fetch(`/api${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } })
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & T
  if (!res.ok) throw Object.assign(new Error(body.error?.message ?? `Request failed (${res.status})`), { status: res.status, code: body.error?.code })
  return body
}

/** Is this wallet on the server's platform admin list? Public and harmless: the list is not revealed, only the answer for one address. */
export function usePlatformAdmin(address: string | undefined) {
  return useQuery({
    queryKey: ['platform-admin', address?.toLowerCase()],
    enabled: Boolean(address),
    staleTime: 60_000,
    retry: false,
    queryFn: () => adminCall<{ configured: boolean; admin: boolean }>('', `/admin/auth/status?address=${address}`),
  })
}

export interface DayPoint {
  date: string
  orderUnits: string
  dcaUnits: string
  swapUnits: string
  totalUnits: string
  trades: number
}
export interface UserStat {
  address: string
  orders: number
  filled: number
  dcaPlans: number
  dcaRuns: number
  swaps: number
  volumeUnits: string
  firstSeen: number
  lastSeen: number
}
export interface ActivityItem {
  kind: 'order_created' | 'order_filled' | 'dca_created' | 'dca_run' | 'swap'
  owner: string | null
  txHash: string
  time: number
  usdcUnits: string | null
}
export interface PlatformResponse {
  chainId: number
  generatedAt: number
  stats: {
    decimals: number
    users: { total: number; active7d: number; new7d: number }
    orders: { created: number; filled: number; cancelled: number; expired: number; open: number; byType: Record<string, number> }
    dca: { plans: number; runs: number; active: number }
    swaps: { count: number; valued: number }
    volumeUnits: { total: string; orders: string; dca: string; swaps: string }
    fees: { swapFeeBps: number | null; swapFeeEstimateUnits: string; swapsFeeNotValued: number; keeperFeeUsdcUnits: string; keeperFeeOtherTokenCount: number }
    days: DayPoint[]
    topUsers: UserStat[]
    recent: ActivityItem[]
  }
  fee: { bps: number | null; recipient: string | null; problem: string | null; balanceUnits: string | null }
  indexer: { running: boolean; lagBlocks: number | null; lastError: string | null; indexedEvents: number }
}

export interface SecretRow {
  name: string
  label: string
  use: string
  where: string
  source: 'admin' | 'env' | 'none'
  hint: string | null
}
export interface SecretsResponse {
  enabled: boolean
  problem: string | null
  secrets: SecretRow[]
}

/** USDC base units (6 decimals) as a plain number for display. Safe for any realistic volume. */
export function unitsToNumber(units: string, decimals = 6): number {
  try {
    const n = BigInt(units)
    const base = 10n ** BigInt(decimals)
    return Number(n / base) + Number(n % base) / Number(base)
  } catch {
    return 0
  }
}
