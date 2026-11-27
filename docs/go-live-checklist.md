# Go-live checklist (production on Arc mainnet)

Do these in order. Items marked **you** cannot be done by the code or by an assistant: they need your wallets, your accounts or a decision only you can make. The older [mainnet-readiness-checklist.md](mainnet-readiness-checklist.md) covers the contract in more depth; this page is the whole launch.

## 1. Decisions only you can make

- [ ] **Audit.** `ArcTradeOrders` has 191 automated tests and a live testnet run, but **no independent audit**. Decide whether to launch without one, cap the size, or commission one first. Say so to users: the landing page already states it.
- [ ] **Fee rate.** `PLATFORM_FEE_BPS` is a business decision (30 = 0.30%, maximum 100). It is off until you set it. The code does not pick one.
- [ ] **Legal pages.** Terms of Service and Privacy Policy must exist before you take real users (`VITE_TERMS_URL`, `VITE_PRIVACY_URL`). Until set, the footer opens a plain placeholder. Check what applies where you and your users are (money services, sanctions, consumer rules). This project does not provide legal advice.
- [ ] **Who holds which key** (all **you**): contract owner, platform admin wallet, fee wallet, keeper wallet. Keep them separate (see section 5).

## 2. The mainnet contract (**you**)

The mainnet contract is deployed and operated by you; nothing in this repo deploys it for you.

1. Deploy `contracts/ArcTradeOrders.sol` from your own wallet with a config delay of 48 hours or more (`docs/deployment.md`). Record the deployment transaction hash.
2. Configure tokens with their Chainlink feeds (`docs/oracle-and-pricing.md`; feeds exist on Arc mainnet only, 24 h heartbeat), the swap targets (the KyberSwap router is `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5`), the minimum order size and the keeper fee. These changes are timelocked.
3. Move ownership to a hardware wallet or multisig (two-step offer and accept). The owner can pause, lower the keeper fee and queue config changes; it cannot take escrowed funds.
4. If you want the Platform dashboard and the Admin page on one wallet, make the owner the same wallet you list in `PLATFORM_ADMIN_ADDRESSES`. They are otherwise independent.

## 3. Environment

Generate a starting file: `bun run scripts/coolify/gen-env.ts --mainnet --new-keeper-key` (writes `deploy/coolify/production.env` with fresh `ADMIN_TOKEN` and `SECRETS_ENCRYPTION_KEY`). Then check it: `bun run scripts/coolify/preflight.ts deploy/coolify/production.env`. Details for each variable: [configuration.md](configuration.md), keys: [api-keys.md](api-keys.md).

**Required**

| Variable | Value |
| --- | --- |
| `VITE_DEFAULT_NETWORK`, `KEEPER_NETWORK`, `INDEXER_NETWORK` | `arc` |
| `VITE_ORDERS_ADDRESS_ARC_MAINNET`, `VITE_ORDERS_DEPLOY_TX_ARC_MAINNET` | Your mainnet contract and its deployment transaction |
| `ADMIN_TOKEN` | Long random string (at least 24 characters). Break-glass key |
| `PLATFORM_ADMIN_ADDRESSES` | The wallet(s) that open the Platform dashboard. Currently `0x378862A20B312298dc54585CbabC531D70F9baE9` |
| `PLATFORM_FEE_RECIPIENT` | Where swap fees are paid. Currently `0x378862A20B312298dc54585CbabC531D70F9baE9` |
| `PLATFORM_FEE_BPS` | Your chosen rate (0 keeps the fee off) |
| `SECRETS_ENCRYPTION_KEY` | 16+ random characters. Needed to save API keys from the dashboard. Keep a copy |
| `KEEPER_PRIVATE_KEY` | A dedicated low-balance wallet with a little USDC for gas. Never the owner or admin key |
| `INDEXER_ENABLED` | `true` (the dashboard and history need it) |
| `RPC_URL_Arc`, `VITE_RPC_URL_ARC` | Your own RPC provider URLs (comma-separated for failover). The public endpoint rate-limits. The `VITE_` one is public: restrict it to your domain |
| `TRUSTED_PROXY_HOPS` | `2` behind Coolify's proxy and nginx (add 1 behind Cloudflare) |
| `ALLOWED_ORIGINS` | Your public origin, for example `https://app.example.com` |
| `DATABASE_URL` | SQLite on the `api-data` volume (default) or Postgres |

**Optional**

| Variable | Purpose |
| --- | --- |
| `VITE_CIRCLE_CLIENT_KEY` (`LIVE_API_KEY:...`), `VITE_CIRCLE_CLIENT_URL`, `VITE_CIRCLE_SPONSOR_GAS` | Passkey wallet. Build-time. Needs the Passkey Domain set to your production host, and a Gas Station policy for sponsored fees. A testnet key does not work on mainnet |
| `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY` | Agent chat model. Or paste them on the Platform page |
| `ZEROEX_API_KEY` | Second quote source next to KyberSwap |
| `ALERT_WEBHOOK_URL` | Slack or Discord alerts for the keeper, indexer and providers |
| `KEEPER_WS_URL`, `KEEPER_ROLE`, `GECKO_CALLS_PER_MIN`, `AGENT_LLM_DAILY_CALLS` | Tuning |
| `VITE_SOCIAL_*`, `VITE_DOCS_URL`, `VITE_SUPPORT_URL`, `VITE_TERMS_URL`, `VITE_PRIVACY_URL` | Footer links. A social link shows only when set |

In Coolify mark `ADMIN_TOKEN`, `SECRETS_ENCRYPTION_KEY`, `KEEPER_PRIVATE_KEY`, `DATABASE_URL`, `ZEROEX_API_KEY` and the chat model keys as **runtime only**. Only `VITE_*` values belong at build time. Run **one** api container: the keeper and indexer hold state.

## 4. Verify before you announce

- [ ] `bun run check`, `bun test`, and `forge test` in `contracts/` all pass on the commit you deploy.
- [ ] `docker compose build` succeeds, and the preflight script prints no `FAIL`.
- [ ] Open the site over HTTPS. Landing, Trade, Dashboard, Agent and Platform load. No console errors.
- [ ] **Platform sign-in:** connect the admin wallet, sign in, see statistics. Try a different wallet: it must be refused.
- [ ] **Fee path (real money, small):** make one market swap of a few dollars on mainnet. Confirm the fee wallet's balance rose by about the fee rate, and that the readback showed the fee before signing. The Platform page shows the fee wallet balance live.
- [ ] **Keeper:** place a small limit order far from the price, check it appears, then cancel and confirm the refund. Make one that fills, if you can, and confirm the keeper wallet earned the fee.
- [ ] **Passkey wallet** (if you enable it): register with a real fingerprint on your production domain, send a sponsored transaction, and try cancelling the prompt. This was never run in this repo.
- [ ] **Agent chat model** (if enabled): press Test on the primary and the fallback on the Platform page.
- [ ] Admin page as the contract owner: pause and resume once, so you know it works before you need it.
- [ ] Backups: the `api-data` volume (indexer database, saved keys, chat settings) and a copy of `SECRETS_ENCRYPTION_KEY` and `ADMIN_TOKEN` in a password manager.

## 5. Operating safely

- **Keys.** Owner, platform admin, fee wallet and keeper should be four different keys. Keeper is a hot key with a small balance; the others are hardware or multisig. Sweep keeper earnings regularly.
- **Monitoring.** Set `ALERT_WEBHOOK_URL`. Watch keeper gas (the Admin page warns under 1 USDC), indexer lag (the Platform page shows it) and provider health.
- **Token approvals.** The app asks for exact-amount approvals. If you add tokens to the contract, check their feed's heartbeat and decimals first.
- **Rotating.** Rotate `ADMIN_TOKEN` after anyone who knew it leaves. Remove a wallet from `PLATFORM_ADMIN_ADDRESSES` and restart: its session ends at once.
- **Incidents.** The owner can pause new orders and fills; cancel and refund keep working while paused, so users are never trapped.

## 6. Known limits to be honest about

- The order contract is unaudited and not yet on mainnet. Users should be told.
- The swap fee is paid by the aggregator inside the swap. Swap statistics depend on the user's browser reporting the swap; the fee wallet balance is the figure that cannot miss.
- 21 of the 60 listed tokens have no liquid pool, so they show a quote and no chart. Orders need a price feed for the token on the contract.
- The passkey wallet needs two fingerprint prompts for an approve-then-order flow, loses access if the passkey is lost without sync, and cannot be a platform admin.
- Statistics cover one chain (the indexed one). Run one api container.
- Nothing here is financial or legal advice.
