# Frontend

React 18, Vite, TypeScript, Tailwind, wagmi v2 with ConnectKit (browser wallets) plus a Circle passkey wallet, viem, TanStack Query, Lightweight Charts, lucide icons.

## Pages

| Page | Component | Contents |
| --- | --- | --- |
| Trade | `Terminal` | Network banner, then two columns: on the left the market header (token selector, price, 24h change, volume, liquidity), chart and order tabs; on the right the trade panel (order types grouped as Market, Entry, Exit, Recurring) and the account box. Collapsible testnet tools on testnet only |
| Dashboard | `Dashboard` | Account value, available and escrowed USDC, realized and unrealized PnL, balances (zero balances of untradable tokens hidden), every order, plan, fill and position, DCA performance |
| Home | `Landing` | The landing page, written to answer a visitor's questions in order: a hero where the real command parser reads a prompt at a live price beside a real chart, who it is for, trust (contract links, networks, token count read live, "no audit yet"), the problems in the trader's words, what you get (AI agent trading, advanced trading, dashboard), six steps from wallet to fill, what it costs (fee read live from the backend), an FAQ, and a closing call. Nothing on it is invented. A connected wallet skips this page and lands on Trade |
| Agent | `AgentStation` | Command-driven trading with readback and one-time permission. See [agent-station.md](agent-station.md) |
| Settings | `SettingsPage` | Look, display, trading, chart, notifications, shortcuts, agent, data and about. Own page (`/#/settings`), reached from the gear in the header or the bottom bar |
| Admin | `Admin` | Owner only. See [admin-guide.md](admin-guide.md) |
| Platform | `Platform` | Platform admin wallets only (`PLATFORM_ADMIN_ADDRESSES`). Wallet sign-in, volume, users, revenue and fee wallet balance, daily chart, activity, API keys and the chat model. See [platform-dashboard.md](platform-dashboard.md). The header link shows only for an admin wallet; the server checks every request |

The layout follows the exchange-terminal pattern: a price header, chart and order form on top, then the orders table beside an account box. The look is a premium dark terminal; see [DESIGN.md](../DESIGN.md). The brand (name, tagline, social and legal links) lives in `src/brand.ts`; the logo is `Logo.tsx`.

Pages are hash routes (`/#/trade`, `/#/agent`), so any page can be linked and the back button works. Page changes fade; landing sections reveal as they scroll into view. On phones a fixed bottom tab bar (`BottomNav`) carries Home (or Trade when connected), Trade, Dashboard, Agent and Settings. Motion obeys Settings and the system "reduce motion" request (`html[data-motion]`), and "off" removes every animation and transition.

Navigation, network selector (Testnet / Mainnet), wallet button, USDC balance, theme toggle and settings live in `Header`; `Footer` shows live status (backend, network, keeper), links, socials and the risk notice. A page that crashes shows a recovery card with a reload button (`ErrorBoundary`) instead of a blank screen. Social links appear only when their `VITE_SOCIAL_*` variable is set (GitHub defaults to this repository); Terms and Privacy open a plain-language placeholder until `VITE_TERMS_URL` / `VITE_PRIVACY_URL` point at real documents.

### Settings

Every setting applies the moment it changes and is remembered in this browser (`src/trading/settings.tsx`, sanitised on load, so old or hand-edited values cannot break the app):

| Tab | Settings |
| --- | --- |
| General | Page the app opens on (Home, Trade, Dashboard), network, the testnet note |
| Look | Theme (dark, light, follow system), accent colour (soft lavender, peach, rose, sky, butter), interface size, table density, motion (full, reduced, off) |
| Display | 12 or 24 hour time, local time or UTC, hide balances (blurs amounts) |
| Trading | Max slippage, order expiry, which order type the form opens on |
| Chart | Style (candles or line), default timeframe, volume bars, moving average |
| Notifications | Which toasts show (all, errors only, off) and where they appear |
| Shortcuts | Switch keyboard shortcuts on or off (`g` then h, t, d, a or s) |
| Agent | Permission summary, revoke, reset today's usage |
| Data | Export, import (validated, size-limited, bad files get a plain message), clear swap history, reset all |
| About | Network, contract and links |

On phones Settings is a list screen; choosing a row opens it with a back button.

On phones the Trade page shows one pane at a time (Order, Chart, Orders, Account) under the pair header; from the `lg` breakpoint everything is visible and the trade panel is a right-hand column. The Agent page works the same way (Chat, Permission, Commands). A network with no tokens or contract (mainnet until it is configured) shows a single "Trading is not enabled" card instead of disabled panels. Only tokens with an oracle feed are offered for trading (`tradableBases`): on testnet that is tBTC, tETH and tSOL; EURC, cirBTC and WETH only appear in the portfolio when held.

Token picker: on mainnet it lists every token the aggregator can route (about 60, loaded from `/api/tokens`, searchable by name, symbol or pasted address, with the contract address shown), so market swaps work for all of them. Each row says whether the token has a price feed for orders. Price, 24h change, volume, liquidity and candles for these tokens come from free DexScreener and GeckoTerminal data via the backend (`/market/token`, `/market/candles`, no keys); about two thirds of the list have a liquid pool. A token with no pool shows the aggregator's price for a 10 USDC trade and a "no chart data" note, never a made-up chart. Orders and DCA also need an oracle feed on the contract and say so when a token has none.

**Admin** (`Admin`): a tab visible only to the contract owner. Contract controls (pause, minimum order, ownership transfer), fees, tokens/routers/timelocked changes and backend status. See [admin-guide.md](admin-guide.md).

Removed on purpose: the swap depth panel, the automation provider list and the EMA 50 chart toggle. The old Prompt Station placeholder is replaced by the working Agent Station. The keeper status is one line under non-market order forms.

## Trade panel

`TradePanel` chooses the order type and side. Stops are sell-only and DCA is buy-only, so the side is derived from the type.

| Type | Form | Needs |
| --- | --- | --- |
| Market | `MarketForm` | 0x supported on the network, API key, backend running |
| Limit, Stop-loss, Take-profit, Stop-limit, Trailing stop, OCO | `ConditionalForm` | Contract address, oracle feed for the token |
| DCA | `DcaForm` | Contract address, oracle feed |

If a requirement is missing the panel shows a specific notice instead of a disabled form. Validation mirrors the contract (for example stop price must be below the current oracle price) so users see errors before signing.

Every create flow goes through `ConfirmModal`: summary rows, warnings, and real step progress (approve exact amount if needed, then create). Steps reflect actual wallet and receipt states, never timers.

## Order tabs

Open orders, DCA plans, Order history, Trades, Positions. Tabs read the same cached queries. Tables paginate at 25 rows. Actions: cancel, refund expired, pause/resume/cancel DCA.

Order history lists every closed order with its status (executed, cancelled, expired), so stop-loss, take-profit and failed or expired orders are filtered by the Type and Status columns rather than separate tabs. Open orders shows a note when orders are ready but not yet filled (waiting on a keeper or an unfavourable market). The contract intentionally has no failure counter, so there is no "failed attempts" list.

Positions only count what was bought through the contract: a sell larger than the tracked purchases never makes the quantity negative, and the untracked part is left out of realized PnL.

## Data layer (`src/trading`)

| File | Purpose |
| --- | --- |
| `networks.ts` | Network config and token lists, reads contract addresses from `VITE_*` |
| `hooks.ts` | `useOracle`, `useOraclePrices`, `useBalances`, `useAllowance`, `useOrders`, `useDcas`, `useExecutionLogs`, `useBackendHealth`, `useNowSeconds` |
| `tx.ts` | `useTx`: ensure the wallet is on the right chain, send, wait for receipt, toast, parse errors |
| `aggregator.ts` | Aggregator adapter, 0x adapter, backend health fetch |
| `market.ts` | Coinbase candles (paged), 4h and 1W aggregation, SMA/EMA, live ticker |
| `math.ts` | Price and amount math mirrored from the contract |
| `portfolio.ts` | Positions and PnL from executed orders and DCA totals |
| `localTrades.ts` | Market swaps sent from this browser |
| `settings.tsx` | Theme, slippage, expiry, network, page (persisted in local storage) |

All reads that touch many contracts use Multicall3. Query keys include the network and owner, so switching networks never shows another network's data.

## Charts

Real data only. BTC, ETH and EURC use Coinbase Exchange candles (`BTC-USD`, `ETH-USD`, `EURC-USDC`) with a WebSocket ticker moving the latest candle. Every other mainnet token uses GeckoTerminal candles for its best DexScreener pool, through the backend cache (`src/trading/market.ts`). Coinbase has no 4h and 1W bars, so those are aggregated from 1h and 1D candles (weeks start Monday 00:00 UTC). If a request fails, or no pool exists, the chart says so and shows no candles. The footer states the source: a Coinbase reference price or a DEX pool price. Indicators: volume, MA 20, EMA 50.

## Wallets

The connect button opens `ConnectDialog` (`src/wallet/`). Browser wallets (MetaMask, Rabby, Coinbase Wallet, WalletConnect) go through ConnectKit as before. When `VITE_CIRCLE_CLIENT_KEY` is set, a **Passkey wallet** option appears: sign in or create an account with a fingerprint, Face ID or a security key. It is a Circle Modular Wallet, an ERC-4337 smart account whose owner is the passkey, so the private key stays in the device's secure hardware.

- `circle.ts` loads the Circle SDK only when someone uses it, keeps the signed-in credential in `sessionStorage` (this tab only) and builds the smart account and bundler per chain.
- `circleProvider.ts` is an EIP-1193 provider: a transaction becomes a user operation (sponsored by Circle Gas Station when `VITE_CIRCLE_SPONSOR_GAS` allows it), signing goes to the passkey, and reads go to the chain RPC. Its dependencies are injected, so it is unit tested without a browser (`tests/circle-wallet.test.ts`).
- `circleConnector.ts` is the wagmi connector. Because the rest of the app talks to wagmi, every form, the Agent and the Dashboard work with a passkey account without changes.

Things to know: the passkey account has its own address; every action asks for the fingerprint, so an order that needs an approval first asks twice; cancelling the prompt reads as a rejected request, not an error; a wrong Passkey Domain in the Circle Console gives a plain message. Setup: [api-keys.md](api-keys.md).

## Portfolio and PnL

PnL covers only fills made through the order contract:

- Average entry = total quote spent / total base bought.
- Realized PnL = proceeds from sells minus average cost of the sold quantity.
- Unrealized PnL = remaining quantity at the current oracle price minus its cost.
- Tokens without an oracle price are listed as "No oracle price" and excluded from total value.

Keeper fees per fill come from execution logs. Wallet swaps made elsewhere are not counted, and the UI says so.

## Design system

Premium dark fintech, written up in [DESIGN.md](../DESIGN.md): the logo's purple on a `#080711` background in dark (a pale lilac paper in light), 1px hairlines, 8 and 12px radii, flat accent fills with their own text colour, Archivo and IBM Plex Mono, no gradients or glow.

## Accessibility and responsiveness

- Tap targets are at least 44 px on phones; inputs are 16px so iOS does not zoom; the bottom bar and the page respect the safe area.
- Tab lists use `role="tablist"` / `tab` / `aria-selected`; modals trap Escape and use `role="dialog"`.
- Layout is two columns on large screens and a single column on tablet and mobile; tables scroll horizontally.

## Extending

- **New token**: add it to `networks.ts` and queue its feed on the contract.
- **New order field**: update `ordersAbi.ts` (regenerate from the build artifact), `types.ts`, the form, and `math.ts` previews, then add a test.
- **New aggregator**: see [aggregator.md](aggregator.md).
- **Regenerating the ABI**: after any contract change, rebuild and regenerate `src/trading/ordersAbi.ts` from `contracts/out/ArcTradeOrders.sol/ArcTradeOrders.json`.
