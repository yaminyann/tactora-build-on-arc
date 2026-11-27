# Platform dashboard

The **Platform** page is for whoever runs the service: statistics, users, revenue and API keys in one place. It is a different role from the contract owner (the **Admin** page, which controls the contract itself). One person can hold both roles, but the two are checked separately.

## Who can open it

A wallet listed in `PLATFORM_ADMIN_ADDRESSES` (comma-separated). The listed wallet signs one message, which is not a transaction and costs nothing, and the server returns a session that lasts 8 hours. The `ADMIN_TOKEN` also works as a break-glass key.

- The Platform link appears in the header only when the connected wallet is on the list. The page itself is reachable at `/#/platform` for anyone, but it shows only a sign-in card until the server accepts a credential. **Every request is checked on the server**; hiding the link is a convenience, not security.
- Use a normal wallet (MetaMask, Rabby, a hardware wallet). A smart-contract wallet, including the passkey wallet, cannot sign in, because its signature cannot be checked without an onchain call. Admin access should sit on a key you keep offline.
- Sessions live in memory. A server restart signs everyone out. Removing an address from the list ends its session at once.
- Contract ownership (Admin page) is separate. To use one wallet for both, transfer the contract's ownership to it (a two-step offer and accept) in addition to listing it here.

## What it shows

Statistics come from the **indexer**, so `INDEXER_ENABLED=true` and `INDEXER_NETWORK` must point at the chain you operate (`arc` in production). They cover one chain at a time.

| Figure | How it is measured |
| --- | --- |
| Total volume | The USDC side of every trade: the USDC spent on a buy order or DCA buy, the USDC received on a sell order, the USDC sold or bought in a market swap. A swap between two non-USDC tokens is counted but not valued. Nothing is priced from outside |
| Users | Distinct wallets that placed an order, started a DCA plan, had a fill, or reported a swap. Active and new users are counted over 7 days. The table lists the top wallets by volume (search by address) |
| Orders, DCA, swaps | Counts from contract events and verified swap reports: placed, filled, cancelled, expired, open, by order type; DCA plans, buys, active; swaps |
| Daily volume | A stacked chart of orders, DCA and swaps per day for 7, 30 or 90 days |
| Swap fees earned | **An estimate:** the current fee rate applied to swaps that sold USDC. The real money is paid by the aggregator inside each swap straight to `PLATFORM_FEE_RECIPIENT` |
| Fee wallet balance | The fee wallet's USDC balance read live from the chain. This is the real number to trust |
| Keeper fees | The fee on filled sell orders, in USDC. It goes to the **keeper wallet**, not the fee wallet. Fills that pay the fee in the bought token are counted but not valued |
| Latest activity | The newest placements, fills, DCA buys and swaps, each linking to the explorer |

Limits to know:

- A market swap appears only after the user's browser reports it. The server re-derives the amounts from the chain receipt, so a forged report cannot add false data, but a swap whose report never arrived (browser closed right after signing) is missing. The fee wallet's balance is the check that cannot miss.
- Swaps made before the indexer started, or on a chain it does not watch, are not counted.
- The page refreshes every 30 seconds, and the server caches the figures for 20 seconds. With very large histories the query reads at most 200,000 rows per table.
- Profit means platform revenue: swap fees (the fee wallet) plus whatever the keeper wallet earns. Users' own profit and loss is on their Dashboard and is not summed here.

## Where the platform fee goes

Set `PLATFORM_FEE_RECIPIENT` to the wallet that should receive the fee and `PLATFORM_FEE_BPS` to the rate in basis points (30 = 0.30%, maximum 100). The fee applies to market swaps made in the browser, is taken by the aggregator inside the swap, and is shown to the user in the readback before they sign. It is off until both are set, and an invalid setting turns it off and logs why.

The fee is **not** charged on orders or DCA. Those earn the keeper fee (at most 0.10% of the output, lowered only by the owner), which is paid to whichever wallet submits the fill. If you want that revenue, run the keeper from a wallet you control and sweep it periodically.

## API keys

The **API keys** panel lists every key the server can use, where each one currently comes from (saved here, the server environment, or not set), and for a saved key its last four characters. To save a key from the page the server needs `SECRETS_ENCRYPTION_KEY`; without it the panel says so and nothing is written.

- Saved keys are encrypted (AES-256-GCM) in `DATA_DIR/secrets.json`. The key is never returned by any route and never reaches the browser after you paste it.
- A key saved here wins over the same key in the environment. Removing it puts the environment value back.
- The change applies to the next request, with no restart.
- Back up the `api-data` volume and keep a copy of `SECRETS_ENCRYPTION_KEY`. If the encryption key is lost, the saved keys cannot be read and must be entered again.
- The **Circle Client Key** is not here. It is public and compiled into the web build (`VITE_CIRCLE_CLIENT_KEY`); changing it needs a rebuild of the web service.

Where to get each key: [api-keys.md](api-keys.md).

## Agent chat model

The page also hosts the chat model section (primary model, optional fallback, test button, usage). See [admin-guide.md](admin-guide.md) and [agent-station.md](agent-station.md).

## Tests

`tests/platform-admin.test.ts` covers the address list, the sign-in (a real signature round trip, wrong signer, replay, expiry, wrong address, malformed input, session end), encrypted key storage (off without a key, ciphertext on disk, restore on remove, wrong key), and the statistics maths (USDC legs, fees, ranking, empty and malformed data).
