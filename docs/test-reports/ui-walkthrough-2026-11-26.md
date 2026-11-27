# Live UI walkthrough, 2026-11-26

Every feature was driven through the browser UI on Arc Testnet against the unaudited v2 contract `0xa83efe842010dbd470dfe7cc210d61c4edd908aa`, with the built-in keeper filling orders. The wallet was a throwaway testnet key behind a local signing bridge (loopback only). Prices were moved with the Testnet tools panel so triggers fired within seconds. Nothing was sent to mainnet; mainnet was only opened to read a live KyberSwap quote.

## Result

| Feature | How it was tested | Result |
| --- | --- | --- |
| Wallet connect, redirect to Trade | Connect from Home, open `#/home` while connected | Pass |
| Live market data | Reference price moved between reads, all seven timeframes, token switch (tBTC, tETH, tSOL) | Pass |
| Market swap, buy and sell | tBTC buy, tSOL buy, tBTC sell, each with exact approval then swap | Pass |
| Limit order (buy and sell) | Created, then price moved across the level | Filled by the keeper |
| Stop-loss | Created at 86,000 and 89,000, price dropped | Filled |
| Take-profit | Created at 95,000 and 91,000, price rose | Filled |
| Stop-limit | Stop 88,000, limit 87,000, price 87,800 | Filled at 87,624 (inside the limit) |
| Trailing stop | 5% and 3%; price rose to a new high, then fell | Keeper recorded the new peak (95,500), then filled below peak minus 5% |
| OCO | Stop leg and take-profit leg, one order each | Both legs filled; the other leg never ran |
| Several orders at one price | Limit buy, stop-loss and trailing stop triggered together | One `executeMany` transaction filled all three |
| Cancel an order | UI and Agent (`cancel order 86`) | Pass, escrow refunded |
| DCA | Created from the form and from the Agent, first buy filled by the keeper at once, pause, resume, cancel with refund | Pass. The second scheduled buy ran one hour later, on its own (executions 2, 0.2 USDC spent, next buy rescheduled one hour on) |
| Agent: read-only | `help`, `balance`, `orders`, `price btc` | Pass |
| Agent: actions | Market buy, stop-loss, limit buy, take-profit, trailing, OCO, DCA, pause, resume, cancel, all with readback, yes, wallet | Pass |
| Agent: chat | Plain-words orders, questions, suggestions from holdings | Pass after fix 3 |
| Validation | Stop above price, take-profit below price, amount over balance, limit above stop, trailing out of range, OCO prices crossed | Review button stays disabled with a message |
| Dashboard | Value, available, escrow, PnL, balances, DCA performance | Pass |
| Settings | All nine sections, shortcuts (`g` then `t` and `d`) | Pass |
| Admin (owner wallet) | State, fees, tokens, routers, owner log, set minimum order size | Pass |
| Mainnet view | Header switch, live KyberSwap quote 10 USDC to 9.10 EURC (reference 1.0983), "order contract not set up" for orders | Pass |
| Mobile 375 px | Trade, Dashboard, Agent, Settings, bottom bar, no horizontal overflow | Pass |

## Issues found and fixed

1. **Orders and DCA were impossible on testnet: the USDC test feed was 13 days stale.** Every price is quote-per-base, so a stale USDC feed makes the contract refuse every new order, and the UI could only refresh the token feed. Fixed: the Testnet tools panel refreshes both feeds and warns when either is older than 6 hours; the keeper re-stamps any stale harness feed every 10 minutes (`KEEPER_REFRESH_TEST_FEEDS=false` turns it off).
2. **The public RPC rate-limited the browser, keeper and wallet.** The browser had one hard-coded URL, no batching, and 1 KB multicalls that split every refresh into several requests. Fixed: `VITE_RPC_URL_ARC_TESTNET` and `VITE_RPC_URL_ARC` (comma list with fallback), JSON-RPC batching, 16 KB multicalls, one multicall for all oracle prices, rows and readiness read together, slower polling, and a plain error message for "rate limit" and "method not available". Measured idle load on the Trade page fell from about 130 to about 60 RPC calls a minute.
3. **The Agent refused to protect a real position.** A stop-loss or OCO on about 88,000 USDC of tBTC was blocked by the 100 USDC per-command limit. Fixed: protective sells (stop-loss, take-profit, stop-limit, trailing, OCO) are exempt from the spending limits and always wait for a yes, even in "run inside limits" mode.
4. **A test router without enough USDC quoted a sell that then reverted.** The sell of 0.00005 tBTC failed with "Execution reverted". Fixed: a router that cannot pay out USDC now answers "no liquidity" (browser and gateway). The router was refilled with 20 test USDC.
5. **The landing page showed invented data and false claims** (fake live prices and order book, "audited", "Custody Risk 0.00%", partner names, a particle animation that ignored the motion setting, four lint errors that turned CI red). Rewritten: live Coinbase reference prices, the real command parser, verifiable facts including "audit: none yet", no animation.
6. **Swap calldata from the backend was only checked for its target.** Now decoded and verified before the wallet is asked: for KyberSwap the tokens, receiver (must be the user), amount and a minimum return no looser than the user's slippage; for 0x the token and amount. Anything unrecognised on a known router is refused. Tested against a real captured quote and tampered copies. The public Arc RPCs do not support simulation, which is why the calldata is read directly.
7. A paused DCA plan showed a countdown ("in 53m"); it now says "On resume".
8. Dead Arc Studio code (`tracing.ts`, `console-capture.ts`) removed from the bundle; package renamed `lumarc`.
9. Dependencies: five unused `@circle-fin` packages removed and two deploy-script-only ones moved to `devDependencies`; the Dockerfile no longer copies `node_modules` between stages and has no `syntax` line (see [deployment-coolify.md](../deployment-coolify.md)).

## Not covered

- The faucet at faucet.circle.com was not used: it needs a human check in the browser. The test wallet already held testnet USDC.
- Real wallets: a local signing bridge stood in for a wallet extension, so wallet prompts and mobile in-app browsers were not exercised.
- The optional chat model was tested against a mock endpoint only.
- `docker build` of the changed Dockerfile was only linted (`docker build --check`); a full build was not run here because the previous attempt restarted Docker Desktop.
- Mainnet orders: there is no mainnet contract.
