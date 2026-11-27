import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useSignMessage } from 'wagmi'
import { clsx } from 'clsx'
import { ExternalLink, LogOut } from 'lucide-react'
import { buildAddressExplorerUrl, buildTxExplorerUrl } from '@/onchain-facts'
import { fmtDateTime, fmtNum, fmtUsd, shortAddr } from '@/trading/format'
import { adminCall, unitsToNumber, useAdminCredential, usePlatformAdmin, type PlatformResponse, type SecretsResponse, type UserStat } from '@/trading/platform'
import { ConnectWalletButton } from '@/wallet/ConnectDialog'
import { AdminLlmSection } from './AdminLlm'
import { Badge, Button, Empty, Notice, Panel, Segmented, Skeleton } from './ui'

const usd = (units: string) => fmtUsd(unitsToNumber(units), 2)
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')

function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'up' }) {
  return (
    <div className="bg-panel p-3 sm:p-4">
      <div className="text-xs font-semibold text-mute">{label}</div>
      <div className={clsx('num mt-1 text-xl font-semibold sm:text-2xl', tone === 'up' && 'text-up')}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-mute">{sub}</div>}
    </div>
  )
}

function AddressLink({ chainId, address, full }: { chainId: number; address: string; full?: boolean }) {
  return (
    <a href={buildAddressExplorerUrl(chainId, address)} target="_blank" rel="noopener noreferrer" title={address} className="num inline-flex items-center gap-1 underline underline-offset-2">
      {full ? address : shortAddr(address)}
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  )
}

// ---------- Sign in ----------

function SignIn({ expired }: { expired: boolean }) {
  const { address, isConnected } = useAccount()
  const status = usePlatformAdmin(address)
  const { signMessageAsync } = useSignMessage()
  const [, setCredential] = useAdminCredential()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tokenOpen, setTokenOpen] = useState(false)
  const [tokenText, setTokenText] = useState('')

  const walletSignIn = async () => {
    if (!address) return
    setBusy(true)
    setError(null)
    try {
      const c = await adminCall<{ message: string; nonce: string }>('', `/admin/auth/challenge?address=${address}`)
      const signature = await signMessageAsync({ message: c.message })
      const r = await adminCall<{ token: string }>('', '/admin/auth/login', { method: 'POST', body: JSON.stringify({ address, nonce: c.nonce, signature }) })
      setCredential(r.token)
    } catch (e) {
      const m = errText(e)
      setError(/reject|denied|cancel/i.test(m) ? 'You cancelled the signature request.' : m)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 py-6">
      <div>
        <h1 className="text-3xl">Platform</h1>
        <p className="mt-1 text-sm text-mute">Volume, users, fees and API keys for the whole platform. Only a platform admin wallet can open it.</p>
      </div>
      <Panel raised className="space-y-3 p-4">
        {expired && <Notice tone="warn" title="Your admin session ended">Sign in again to continue.</Notice>}
        {!isConnected ? (
          <>
            <p className="text-sm">Connect the admin wallet, then sign one message. The message is not a transaction and costs nothing.</p>
            <ConnectWalletButton className="min-h-[44px] px-4 text-sm" label="Connect admin wallet" />
          </>
        ) : status.isLoading ? (
          <Skeleton className="h-11" />
        ) : status.data && !status.data.configured ? (
          <Notice tone="warn" title="No platform admin is set up">Set PLATFORM_ADMIN_ADDRESSES on the server, or sign in with the ADMIN_TOKEN below.</Notice>
        ) : status.data?.admin ? (
          <>
            <p className="text-sm">
              Connected as <span className="num font-semibold">{shortAddr(address ?? '')}</span>. Sign the one-time message to open the dashboard. It works for 8 hours.
            </p>
            <Button variant="primary" onClick={() => void walletSignIn()} loading={busy}>
              Sign in with wallet
            </Button>
          </>
        ) : (
          <Notice tone="warn" title="This wallet is not a platform admin">
            Connected as {shortAddr(address ?? '')}. Switch to the admin wallet, or sign in with the ADMIN_TOKEN below. The passkey wallet cannot sign in here: use a normal wallet.
          </Notice>
        )}
        {error && <p className="text-xs font-semibold text-down" role="alert">{error}</p>}

        <div className="border-t border-line pt-3">
          <button className="min-h-[44px] text-xs font-semibold underline underline-offset-4" onClick={() => setTokenOpen((v) => !v)} aria-expanded={tokenOpen}>
            Use the ADMIN_TOKEN instead
          </button>
          {tokenOpen && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (tokenText.trim()) setCredential(tokenText.trim())
              }}
            >
              <label className="min-w-0 flex-1">
                <span className="sr-only">Admin token</span>
                <input type="password" value={tokenText} onChange={(e) => setTokenText(e.target.value)} autoComplete="off" placeholder="ADMIN_TOKEN" className="num min-h-[44px] w-full border border-line bg-panel px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" />
              </label>
              <Button type="submit">Open</Button>
            </form>
          )}
        </div>
      </Panel>
    </div>
  )
}

// ---------- Dashboard parts ----------

const SERIES = [
  { key: 'orderUnits', label: 'Orders', cls: 'fill-accent' },
  { key: 'dcaUnits', label: 'DCA', cls: 'fill-ink' },
  { key: 'swapUnits', label: 'Swaps', cls: 'fill-mute' },
] as const

function VolumeChart({ days }: { days: PlatformResponse['stats']['days'] }) {
  const totals = days.map((d) => unitsToNumber(d.totalUnits))
  const max = Math.max(...totals, 0)
  const W = 600
  const H = 170
  const pad = { l: 44, r: 6, t: 8, b: 20 }
  const bw = (W - pad.l - pad.r) / days.length
  if (max === 0) return <Empty title="No volume in this period">Trades will appear here once orders fill, DCA buys run or swaps are reported.</Empty>
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Daily volume in USDC for the last ${days.length} days. Highest day ${fmtUsd(max, 0)}.`}>
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="stroke-line" strokeWidth="1" />
        <text x={pad.l - 6} y={y(max) + 4} textAnchor="end" className="fill-mute text-[10px]">{fmtNum(max, 0)}</text>
        <text x={pad.l - 6} y={y(0) + 4} textAnchor="end" className="fill-mute text-[10px]">0</text>
        {days.map((d, i) => {
          const parts = SERIES.map((s) => ({ ...s, v: unitsToNumber(d[s.key]) }))
          return (
            <g key={d.date}>
              <title>{`${d.date}: ${usd(d.totalUnits)} in ${d.trades} trades`}</title>
              {parts.map((p, idx) => {
                if (p.v === 0) return null
                const base = parts.slice(0, idx).reduce((n, q) => n + q.v, 0)
                const top = y(base + p.v)
                return <rect key={p.key} x={pad.l + i * bw + bw * 0.15} y={top} width={bw * 0.7} height={Math.max(y(base) - top, 1)} className={clsx(p.cls, 'stroke-line')} strokeWidth="0.75" />
              })}
            </g>
          )
        })}
        <text x={pad.l} y={H - 4} className="fill-mute text-[10px]">{days[0].date.slice(5)}</text>
        <text x={W - pad.r} y={H - 4} textAnchor="end" className="fill-mute text-[10px]">{days[days.length - 1].date.slice(5)}</text>
      </svg>
      <ul className="mt-1 flex flex-wrap gap-3 text-xs">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <svg width="12" height="12" aria-hidden="true">
              <rect width="12" height="12" className={clsx(s.cls, 'stroke-line')} strokeWidth="1" />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Revenue({ data }: { data: PlatformResponse }) {
  const { fee, stats, chainId } = data
  const f = stats.fees
  return (
    <Panel className="space-y-3 p-4">
      <h2 className="text-lg">Revenue</h2>
      {fee.problem && <Notice tone="error" title="Swap fee is off">{fee.problem}</Notice>}
      {!fee.recipient && !fee.problem && <Notice tone="warn" title="No swap fee is being collected">Set PLATFORM_FEE_BPS and PLATFORM_FEE_RECIPIENT on the server.</Notice>}
      <dl className="space-y-2 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-mute">Fee wallet</dt>
          <dd>{fee.recipient ? <AddressLink chainId={chainId} address={fee.recipient} /> : 'Not set'}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-mute">Balance now (USDC, live from the chain)</dt>
          <dd className="num font-semibold">{fee.balanceUnits === null ? (fee.recipient ? 'Unavailable' : 'n/a') : usd(fee.balanceUnits)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-mute">Swap fee rate</dt>
          <dd className="num">{fee.bps ? `${(fee.bps / 100).toFixed(2)}%` : 'Off'}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-mute">Swap fees earned (estimate)</dt>
          <dd className="num font-semibold text-up">{usd(f.swapFeeEstimateUnits)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-mute">Keeper fees on sell orders</dt>
          <dd className="num">{usd(f.keeperFeeUsdcUnits)}</dd>
        </div>
      </dl>
      <ul className="list-disc space-y-1 pl-4 text-xs text-mute">
        <li>The swap fee is paid by the aggregator straight to the fee wallet, so its balance is the real number. The estimate counts swaps that sold USDC at today's rate.</li>
        {f.swapsFeeNotValued > 0 && <li>{fmtNum(f.swapsFeeNotValued, 0)} swaps sold another token, so their fee is in that token and is not counted in USD.</li>}
        <li>Keeper fees go to the wallet that runs the keeper, not the fee wallet. {f.keeperFeeOtherTokenCount > 0 ? `${fmtNum(f.keeperFeeOtherTokenCount, 0)} fills paid their fee in the bought token.` : ''}</li>
      </ul>
    </Panel>
  )
}

const PAGE = 12

function UsersTable({ users, total, chainId }: { users: UserStat[]; total: number; chainId: number }) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? users.filter((u) => u.address.includes(needle)) : users
  }, [users, q])
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  const cur = Math.min(page, pages - 1)
  const rows = list.slice(cur * PAGE, cur * PAGE + PAGE)
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3 sm:p-4">
        <div>
          <h2 className="text-lg">Users</h2>
          <p className="text-xs text-mute">
            {fmtNum(total, 0)} wallets have used the platform. {total > users.length ? `Showing the top ${fmtNum(users.length, 0)} by volume.` : 'Sorted by volume.'}
          </p>
        </div>
        <label>
          <span className="sr-only">Search by address</span>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(0)
            }}
            placeholder="Search address"
            className="num min-h-[44px] w-full border border-line bg-panel px-3 text-sm sm:w-64 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          />
        </label>
      </div>
      {rows.length === 0 ? (
        <div className="p-4">
          <Empty title={users.length === 0 ? 'No users yet' : 'No wallet matches'}>{users.length === 0 ? 'Wallets appear here after their first order, DCA plan or reported swap.' : 'Check the address and try again.'}</Empty>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line bg-raised text-xs text-mute">
              <tr>
                <th className="p-3 font-semibold">Wallet</th>
                <th className="p-3 text-right font-semibold">Orders (filled)</th>
                <th className="p-3 text-right font-semibold">DCA runs</th>
                <th className="p-3 text-right font-semibold">Swaps</th>
                <th className="p-3 text-right font-semibold">Volume</th>
                <th className="p-3 font-semibold">First seen</th>
                <th className="p-3 font-semibold">Last active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.address} className="border-b border-line last:border-0">
                  <td className="p-3">
                    <AddressLink chainId={chainId} address={u.address} />
                  </td>
                  <td className="num p-3 text-right">
                    {u.orders} ({u.filled})
                  </td>
                  <td className="num p-3 text-right">{u.dcaRuns}</td>
                  <td className="num p-3 text-right">{u.swaps}</td>
                  <td className="num p-3 text-right font-semibold">{usd(u.volumeUnits)}</td>
                  <td className="p-3 text-xs text-mute">{fmtDateTime(u.firstSeen)}</td>
                  <td className="p-3 text-xs text-mute">{fmtDateTime(u.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between gap-2 border-t border-line p-3 text-xs">
          <Button onClick={() => setPage(Math.max(0, cur - 1))} disabled={cur === 0}>
            Previous
          </Button>
          <span className="num">
            Page {cur + 1} of {pages}
          </span>
          <Button onClick={() => setPage(Math.min(pages - 1, cur + 1))} disabled={cur >= pages - 1}>
            Next
          </Button>
        </div>
      )}
    </Panel>
  )
}

const KIND: Record<PlatformResponse['stats']['recent'][number]['kind'], string> = {
  order_created: 'Order placed',
  order_filled: 'Order filled',
  dca_created: 'DCA started',
  dca_run: 'DCA buy',
  swap: 'Swap',
}

function Activity({ items, chainId }: { items: PlatformResponse['stats']['recent']; chainId: number }) {
  return (
    <Panel className="p-4">
      <h2 className="mb-2 text-lg">Latest activity</h2>
      {items.length === 0 ? (
        <Empty title="Nothing yet">New orders, fills and swaps show up here.</Empty>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {items.map((a) => (
            <li key={`${a.txHash}-${a.kind}-${a.time}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2">
              <span className="font-semibold">{KIND[a.kind]}</span>
              <span className="num text-xs text-mute">{a.owner ? shortAddr(a.owner) : ''}</span>
              <span className="num">{a.usdcUnits ? usd(a.usdcUnits) : ''}</span>
              <a href={buildTxExplorerUrl(chainId, a.txHash)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[32px] items-center gap-1 text-xs text-mute underline underline-offset-2">
                {fmtDateTime(a.time)}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function Keys({ token }: { token: string }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin-secrets', token], queryFn: () => adminCall<SecretsResponse>(token, '/admin/secrets'), retry: false })
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<{ name: string; text: string; ok: boolean } | null>(null)
  const save = useMutation({
    mutationFn: (v: { name: string; value: string }) => adminCall<SecretsResponse>(token, `/admin/secrets/${v.name}`, { method: 'PUT', body: JSON.stringify({ value: v.value }) }),
    onSuccess: (data, v) => {
      qc.setQueryData(['admin-secrets', token], data)
      void qc.invalidateQueries({ queryKey: ['admin-llm'] })
      setDrafts((d) => ({ ...d, [v.name]: '' }))
      setMsg({ name: v.name, text: 'Saved. It is used from the next request.', ok: true })
    },
    onError: (e, v) => setMsg({ name: v.name, text: errText(e), ok: false }),
  })
  const remove = useMutation({
    mutationFn: (name: string) => adminCall<SecretsResponse>(token, `/admin/secrets/${name}`, { method: 'DELETE' }),
    onSuccess: (data, name) => {
      qc.setQueryData(['admin-secrets', token], data)
      void qc.invalidateQueries({ queryKey: ['admin-llm'] })
      setMsg({ name, text: 'Removed. The server environment value, if any, is used again.', ok: true })
    },
    onError: (e, name) => setMsg({ name, text: errText(e), ok: false }),
  })

  return (
    <Panel className="space-y-3 p-4">
      <div>
        <h2 className="text-lg">API keys</h2>
        <p className="text-xs text-mute">Keys saved here are encrypted on the server and never shown again, only the last four characters. A key from the server environment is used when none is saved here.</p>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.isError || !q.data ? (
        <Notice tone="error" title="Could not load keys">{errText(q.error)}</Notice>
      ) : (
        <>
          {!q.data.enabled && (
            <Notice tone="warn" title="Saving keys here is off">
              Set SECRETS_ENCRYPTION_KEY (at least 16 random characters) on the server and restart it. Until then, put keys in the server environment. Nothing is ever stored unencrypted.
            </Notice>
          )}
          {q.data.problem && <Notice tone="error" title="Problem with saved keys">{q.data.problem}</Notice>}
          <ul className="divide-y divide-line border border-line">
            {q.data.secrets.map((s) => (
              <li key={s.name} className="grid gap-2 p-3 lg:grid-cols-[1fr_1.2fr] lg:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{s.label}</span>
                    <Badge tone={s.source === 'none' ? 'warn' : s.source === 'admin' ? 'accent' : 'up'}>{s.source === 'admin' ? `Saved here, ends ${s.hint ?? ''}` : s.source === 'env' ? 'From server environment' : 'Not set'}</Badge>
                  </div>
                  <p className="text-xs text-mute">
                    {s.use}. <span className="num">{s.name}</span>
                    {s.where.startsWith('https://') && (
                      <>
                        {' '}
                        <a href={s.where} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                          Get a key
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const value = (drafts[s.name] ?? '').trim()
                    if (value) save.mutate({ name: s.name, value })
                  }}
                >
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">New value for {s.label}</span>
                    <input
                      type="password"
                      autoComplete="off"
                      disabled={!q.data.enabled}
                      value={drafts[s.name] ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [s.name]: e.target.value }))}
                      placeholder={s.source === 'admin' ? 'Paste a new key to replace' : 'Paste key'}
                      className="num min-h-[44px] w-full border border-line bg-panel px-3 text-sm disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    />
                  </label>
                  <Button type="submit" variant="primary" disabled={!q.data.enabled || !(drafts[s.name] ?? '').trim()} loading={save.isPending && save.variables?.name === s.name}>
                    Save
                  </Button>
                  {s.source === 'admin' && (
                    <Button type="button" variant="danger" onClick={() => remove.mutate(s.name)} loading={remove.isPending && remove.variables === s.name}>
                      Remove
                    </Button>
                  )}
                  {msg?.name === s.name && (
                    <p className={clsx('w-full text-xs font-semibold', msg.ok ? 'text-up' : 'text-down')} role={msg.ok ? 'status' : 'alert'}>
                      {msg.text}
                    </p>
                  )}
                </form>
              </li>
            ))}
          </ul>
          <p className="text-xs text-mute">The Circle Client Key (VITE_CIRCLE_CLIENT_KEY) is part of the web build and cannot be changed here. Set it in the build environment and redeploy the web service.</p>
        </>
      )}
    </Panel>
  )
}

function Dashboard({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const q = useQuery({
    queryKey: ['platform-stats', token, days],
    queryFn: () => adminCall<PlatformResponse>(token, `/admin/platform/stats?days=${days}&users=200`),
    refetchInterval: 30_000,
    retry: false,
  })
  const d = q.data
  const s = d?.stats
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-3xl">Platform</h1>
        {d && <Badge tone={d.indexer.running && !d.indexer.lastError ? 'up' : 'warn'}>{d.chainId === 5042 ? 'Arc mainnet' : 'Arc testnet'}</Badge>}
        {d && d.indexer.lagBlocks !== null && <span className="text-xs text-mute">Indexer {d.indexer.lagBlocks} blocks behind</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            value={days}
            onChange={setDays}
            options={[
              { id: 7, label: '7 days' },
              { id: 30, label: '30 days' },
              { id: 90, label: '90 days' },
            ]}
          />
          <Button onClick={onSignOut}>
            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
          </Button>
        </div>
      </div>

      {q.isLoading && <Skeleton className="h-72" />}
      {q.isError && (
        <Notice tone="error" title="Could not load statistics">
          {errText(q.error)}
        </Notice>
      )}
      {d && s && (
        <>
          {d.indexer.lastError && <Notice tone="warn" title="The indexer reported an error">Numbers may be behind. {d.indexer.lastError}</Notice>}
          <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
            <Tile label="Total volume" value={usd(s.volumeUnits.total)} sub="USDC leg of every trade" />
            <Tile label="Swap fees earned" value={usd(s.fees.swapFeeEstimateUnits)} sub={s.fees.swapFeeBps ? `Estimate at ${(s.fees.swapFeeBps / 100).toFixed(2)}%` : 'Fee is off'} tone="up" />
            <Tile label="Fee wallet balance" value={d.fee.balanceUnits === null ? 'n/a' : usd(d.fee.balanceUnits)} sub="USDC, live" />
            <Tile label="Users" value={fmtNum(s.users.total, 0)} sub={`${s.users.active7d} active, ${s.users.new7d} new in 7 days`} />
            <Tile label="Orders filled" value={fmtNum(s.orders.filled, 0)} sub={`${s.orders.open} open, ${s.orders.created} placed`} />
            <Tile label="DCA buys" value={fmtNum(s.dca.runs, 0)} sub={`${s.dca.active} active of ${s.dca.plans} plans`} />
            <Tile label="Swaps" value={fmtNum(s.swaps.count, 0)} sub={`${usd(s.volumeUnits.swaps)} valued`} />
            <Tile label="Order volume" value={usd(s.volumeUnits.orders)} sub={`DCA ${usd(s.volumeUnits.dca)}`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Panel className="p-4">
              <h2 className="mb-2 text-lg">Daily volume</h2>
              <VolumeChart days={s.days} />
            </Panel>
            <Revenue data={d} />
          </div>

          <UsersTable users={s.topUsers} total={s.users.total} chainId={d.chainId} />

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Activity items={s.recent} chainId={d.chainId} />
            <Panel className="p-4">
              <h2 className="mb-2 text-lg">Orders by type</h2>
              {Object.keys(s.orders.byType).length === 0 ? (
                <Empty title="No orders yet" />
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {Object.entries(s.orders.byType)
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, n]) => (
                      <li key={name} className="flex justify-between gap-2 border-b border-line pb-1.5 last:border-0">
                        <span>{name}</span>
                        <span className="num font-semibold">{n}</span>
                      </li>
                    ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-mute">
                Cancelled {s.orders.cancelled}, expired {s.orders.expired}.
              </p>
            </Panel>
          </div>
        </>
      )}

      <Keys token={token} />
      <AdminLlmSection token={token} />
    </div>
  )
}

/** The platform admin's page: statistics, revenue, users and API keys. The server checks every request. */
export function Platform() {
  const [token, setCredential] = useAdminCredential()
  const session = useQuery({
    queryKey: ['admin-session', token],
    queryFn: () => adminCall<{ kind: 'wallet' | 'token'; address: string | null }>(token, '/admin/session'),
    retry: false,
    staleTime: 60_000,
  })
  const rejected = session.isError
  const hadCredential = Boolean(token)

  // A credential the server no longer accepts (expired session, wrong token) is dropped so the sign-in card shows.
  useEffect(() => {
    if (rejected && hadCredential) setCredential('')
  }, [rejected, hadCredential, setCredential])

  if (session.isLoading) return <Skeleton className="h-72" />
  if (!session.data) return <SignIn expired={rejected && hadCredential} />
  return (
    <Dashboard
      token={token}
      onSignOut={() => {
        if (token) void adminCall(token, '/admin/auth/logout', { method: 'POST' }).catch(() => undefined)
        setCredential('')
      }}
    />
  )
}
