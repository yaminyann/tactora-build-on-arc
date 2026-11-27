# Tactora (repository: Arc Terminal; formerly Lumarc)


Project memory for future agents.

## What This App Does

Non-custodial trading terminal on Arc: market swaps through a quote gateway (0x, KyberSwap; test routers on testnet), escrowed conditional orders and DCA via `ArcTradeOrders`, and a portfolio page.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind (class dark mode, CSS variable tokens in `src/index.css`)
- Web3: wagmi v2, viem, ConnectKit
- Contracts: Solidity + Foundry in `contracts/`, tests in `contracts/test/` (191 tests, run with Foundry v1.7.1)
- Backend: `server/` (Bun). `bun run server`. Vite proxies `/api` to :3001. Quote gateway in `server/gateway/`, event indexer in `server/indexer/` (SQLite or Postgres via Bun SQL)
- Chain: Arc Testnet (5042002) default; Arc mainnet (5042) supported by config

## Deployed contracts

- ArcTradeOrders **v2** on Arc Testnet (current, unaudited): `0xa83efe842010dbd470dfe7cc210d61c4edd908aa`, saved as `VITE_ORDERS_ADDRESS_ARC_TESTNET` and in `src/trading/testnet-harness.json`. Superseded: v1 harness `0x259d5810aadfde23ac193dce84e6462025cea02c` (kept as `ordersV1`) and `0x7da5f7d0cf7f5c751dfed545ebf72400c87b724e` (shared platform owner).
- v2 adds: owner-set minimum order size, expiring queued config, rich `ConfigQueued`, oracle round check, paged views, `executeMany`, no `renounceOwnership`. Runtime size is 23,778 B of the 24,576 B limit: run `forge build --sizes` before adding code.
- No mainnet deployment. Mainnet is deployed and operated by the user.

## Verified Arc facts (researched 2026-11-11)

- 0x Swap API supports Arc mainnet only (not testnet). Needs `ZEROEX_API_KEY` on the backend. KyberSwap (`aggregator-api.kyberswap.com/arc`, keyless) is live on Arc mainnet (verified 2026-11-12); its router is `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5`. Neither exists on Arc Testnet, so testnet swaps use the test routers.
- Arc emits a `Transfer` log for the native gas fee from `0xfffffffffffffffffffffffffffffffffffffffe`; ignore it when deriving swaps from receipts.
- Stock anvil cannot execute Arc USDC transfers (native precompile); a mainnet fork needs Arc's Foundry fork.
- Foundry v1.7.1 is at `~/.foundry-v1.7.1` on the dev machine, bun at `~/.bun/bin` (the PATH `bun` shim is broken).
- Chainlink Data Feeds exist on Arc mainnet only; feed list in the chainlink skill reference. Heartbeat 24h, call `decimals()`.
- Gelato Web3 Functions shut down 2026-03-31. Chainlink Automation: no Arc evidence. Execution is permissionless keepers (`server/keeper.ts`).
- USDC is the gas token; show one USDC balance from the 6-decimal ERC-20 view.

## Design decisions

- Trailing-stop peaks and stop-limit activation are only persisted by `pokeTrailing` and `activateStop`; a keeper must call them.
- Execution reverts on failure (no failure counters) so griefers cannot brick orders.
- Owner config changes (feeds, swap targets) are timelocked; disabling is instant; keeper fee can only be lowered.
- Mainnet `bases` in `src/trading/networks.ts` stay empty on purpose: the picker loads ~60 aggregator-routable tokens from `/api/tokens` (KyberSwap registry, filtered). Market swaps work for all; orders need an oracle feed on the contract.
- Platform fee: market swaps only, via the aggregator's own fee params (`PLATFORM_FEE_BPS` max 100, `PLATFORM_FEE_RECIPIENT`); invalid settings turn it off. Order revenue is the keeper fee (lower-only). No contract change.
- Brand lives in `src/brand.ts` (name Tactora, tagline, links from `VITE_SOCIAL_*`/`VITE_*_URL`; never invent social handles). Pages (hash routes `#/home` etc.): Home (landing), Trade, Dashboard (was Portfolio), Agent, Admin. There is no lending page: it was removed on request. Settings is a page (`#/settings`, `SettingsPage.tsx`), not a dialog. Design is a premium dark fintech terminal, rules in `DESIGN.md`: brand colours taken from the logo (primary `#7138FF`, violet `#963BFF`, lavender `#C18AFF`, highlight `#E5C5FF`, dark purple `#3510A8`, background `#080711`), dark by default with a light theme, 1px hairlines, 8/12px radii, no gradients or glow, flat accent fill with its own text colour (four brand accents in `settings.tsx`; old accent names map to `primary`), Archivo 700/800 headings, Archivo body, IBM Plex Mono numbers. Logo assets are in `public/` (`tactora-mark.png`, `tactora-mark-wide.png`, favicons, `manifest.webmanifest`); storage keys still start with `lumarc-` on purpose so saved settings survive. Phones get an app shell: compact header plus a fixed bottom tab bar (`BottomNav.tsx`), pane tabs on Trade and Agent, list/detail Settings. A connected wallet never sees the landing page (redirect to Trade in `App.tsx`). `ErrorBoundary` wraps pages so one crash cannot blank the app. Motion goes through `components/motion.tsx` and obeys Settings > Motion and prefers-reduced-motion. No emoji, no em dashes in UI copy.
- Agent Station (`src/trading/agent/`, `src/components/AgentStation.tsx`) executes only commands of a deterministic grammar (`parser.ts`): it builds a plan from live data, reads it back, waits for yes, then runs the form calls. In front of it is a chat layer: `chat.ts` (free, in-browser rules: plain wording to a command, FAQ, holdings-based suggestions) and an optional model (`server/agent-llm.ts`, `server/agent-chat.ts`, `POST /agent-chat`; the admin picks primary and optional fallback provider (OpenRouter, Gemini, OpenAI, custom) on the Platform page (Agent chat model), saved in `DATA_DIR/agent-llm.json`; keys only in server env; sees only the message and token symbols; its output must pass the strict parser). Never let model or chat output skip the readback. One-time permission with limits and scopes in `agent-permission.ts`; the wallet still signs every tx. See `docs/agent-station.md`.
- Market-swap calldata from the backend is verified in the browser before signing (`assertSwapMatchesRequest` in `src/trading/aggregator.ts`: Kyber tokens, receiver, amount and minimum return; 0x token and amount; anything unrecognised on a known router is refused). Public Arc RPCs have no `eth_simulateV1`, so it decodes instead of simulating. Protective agent orders (stop, take-profit, trailing, OCO) are exempt from the spend limits but always need a yes. Browser RPC URLs come from `VITE_RPC_URL_ARC_TESTNET` / `VITE_RPC_URL_ARC`; the public endpoint rate-limits. On testnet the keeper re-stamps stale test feeds (USDC feed included).
- Settings (`src/trading/settings.tsx`) are sanitised on load and applied live (theme, accent, size, slippage, expiry, defaults, agent grant). Key `lumarc-settings-v2` (older keys are read once). Live attributes on `<html>`: `data-motion`, `data-density`, `data-toasts`, `data-privacy` (blurs `.sensitive` balances). Keyboard: `g` then h/t/d/a/s.
- Admin page (`src/components/Admin.tsx`) is shown to the contract owner only; owner log comes from `/admin-events` (needs the indexer).
- Free market data: `server/market/dex.ts` (DexScreener for pool, price, 24h change, volume, liquidity; GeckoTerminal for candles, budget `GECKO_CALLS_PER_MIN`), routes `/market/token` and `/market/candles`, no keys. BTC/ETH/EURC keep Coinbase. Tokens with no liquid pool (about a third of the list) show the aggregator quote and no chart on purpose, never a fake one. Pool ids may be 20 or 32 bytes (`POOL_RE`).
- Circle passkey wallet (`src/wallet/`): Circle Modular Wallets smart account behind an EIP-1193 provider and a wagmi connector, opened from `ConnectDialog`. Off unless `VITE_CIRCLE_CLIENT_KEY` is set (public). Credential in `sessionStorage` only. Testnet gas is sponsored by default, mainnet needs a Gas Station policy and `VITE_CIRCLE_SPONSOR_GAS=true`. A real passkey flow was never run in this repo (needs the owner's Client Key and domain): test on testnet before announcing. Keys guide: `docs/api-keys.md`.
- Landing page (`Landing.tsx`) follows the seven visitor questions in order (who it is for, trust, the problem, what you get, how it works, price, what if). Only real or live content: no testimonials, invented stats or audit claims; proof is the public testnet run, the contract links and the honest "no audit". The hero and the Agent section run the real command parser and chat rules (`parseCommand`, `interpretChat`, `describeIntent`) at a live ETH price from Coinbase next to a real chart, so the page shows the product working and not a mock window. No decorative backgrounds.
- Platform dashboard (`Platform.tsx`, `src/trading/platform.ts`, `server/admin-auth.ts`, `server/platform-stats.ts`, `server/secrets.ts`, docs `docs/platform-dashboard.md`): platform admins are wallets in `PLATFORM_ADMIN_ADDRESSES` (EOA signatures only, in-memory 8 h sessions, `ADMIN_TOKEN` stays as break-glass). Shows volume, users, revenue, fee wallet balance, API keys (saved encrypted with `SECRETS_ENCRYPTION_KEY`, copied into `process.env`, never returned) and the chat model. Stats come from the indexer of one chain; volume is the USDC leg only; the swap fee figure is an estimate and the fee wallet balance is the real number. Platform admin is separate from the contract owner. Swap fees go to `PLATFORM_FEE_RECIPIENT` via the aggregator; keeper fees go to the keeper wallet. Launch list: `docs/go-live-checklist.md`.
- Deploy: `Dockerfile` (targets web, api), `docker-compose.yml`, `deploy/nginx.conf`, `scripts/coolify/{gen-env,preflight}.ts`. One api container only (keeper + indexer hold state).

## Scaling (off-chain only; contract unchanged)

- Keeper keeps an in-memory open set, batches reads with Multicall3, caps actions per tick, backs off failing items, supports id sharding (`server/keeper.ts`, helpers in `server/scale.ts`).
- Backend caches/coalesces `/price` per pair (not per wallet), rate limits per client (`x-forwarded-for` ignored unless `TRUSTED_PROXY_HOPS`), exposes `/metrics` (operator only, Prometheus format available) and sends webhook alerts.
- Keeper: gateway quotes, profit gate, explicit nonces, standby role, WebSocket wake (`KEEPER_WS_URL`).
- Frontend reads use multicall, history logs resume from a stored block, tables paginate.
- Contract-level scaling ideas (batch execute, paged views) need a new audit; see `docs/scaling.md`.
- Docs live in `docs/`; keep them in sync when behaviour changes.

## Key Files

- `contracts/ArcTradeOrders.sol` - escrow, oracle checks, orders, DCA
- `src/trading/` - networks, math, hooks, aggregator adapter, market data, portfolio
- `src/components/` - Terminal, TradePanel, forms, OrderTabs, Portfolio, NetworkBanner, TestnetTools
- `server/` - quote gateway (`gateway/`), keeper (`keeper.ts`, `keeper-core.ts`), indexer (`indexer/`), alerts, automation provider registry
- `scripts/load-test.ts`, `scripts/fork-mainnet-test.ts` - load test and mainnet-fork test
- `.env.example` lists every setting; `docs/indexer.md` describes the history API
- `tests/*.test.ts` - `bun test` (trading, gateway, indexer, backend integration)
- `ordersAbi.ts` is generated from the Foundry artifact; regenerate after contract changes

## Share links

- Use `buildShareLink` from `src/lib/share.ts` for any link a user copies; keep `installShareSync()` in `src/main.tsx`.
- Never put secrets in URL paths or queries.
