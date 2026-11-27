# API keys and accounts: where each one comes from

Everything below is free or optional. Nothing here is required to run the terminal on testnet. Secrets go in the backend environment (`.env` locally, the api service in Coolify) and are never prefixed with `VITE_`. Values that start with `VITE_` are public: they are compiled into the web bundle and visible to every visitor.

| What | Needed for | Cost | Where it goes |
| --- | --- | --- | --- |
| Circle Client Key | Passkey (fingerprint) wallet | Free | `VITE_CIRCLE_CLIENT_KEY` (public, build time) |
| OpenRouter key | Agent chat model, many low-cost and free models | Free models exist; paid optional | `OPENROUTER_API_KEY` (secret) |
| Google AI Studio key | Agent chat model, free daily quota | Free tier | `GEMINI_API_KEY` (secret) |
| OpenAI key | Agent chat model | Paid per use, no free tier | `OPENAI_API_KEY` (secret) |
| 0x API key | Extra swap quotes on Arc mainnet | Free plan | `ZEROEX_API_KEY` (secret) |
| Arc RPC URL | Faster, less rate-limited chain reads | Free tiers exist | `VITE_RPC_URL_ARC*`, `RPC_URL_Arc*` |
| DexScreener, GeckoTerminal, KyberSwap, Coinbase | Prices, charts, token list, quotes | Free, **no key** | Nothing to set |

## 1. Circle passkey wallet (fingerprint, Face ID, security key)

The passkey wallet is a Circle Modular Wallet: a smart contract account whose owner is a passkey on the user's device. The private key stays in the device's secure hardware. The app only handles a credential id and a public key.

1. Sign in at <https://console.circle.com> (free developer account).
2. Open **Keys**, then **Client Keys**, and create a Client Key. Copy it when it is shown. It starts with `TEST_API_KEY:` for testnet or `LIVE_API_KEY:` for mainnet. Testnet keys do not work on mainnet.
3. Set the **Passkey Domain** in the Console to the exact host your site runs on, for example `localhost` while developing and `app.example.com` in production. A passkey is bound to its domain: a passkey created on `localhost` does not work on your production host, and a wrong domain gives the error "This passkey belongs to a different website address".
4. Put the key in the environment:

```env
VITE_CIRCLE_CLIENT_KEY=TEST_API_KEY:...
# Optional. The default is Circle's public endpoint.
# VITE_CIRCLE_CLIENT_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl
# Optional. true or false. Default: true on testnet, false on mainnet.
# VITE_CIRCLE_SPONSOR_GAS=true
```

Without `VITE_CIRCLE_CLIENT_KEY` the passkey option is hidden and the normal wallets (MetaMask, Rabby, WalletConnect and so on) work as before. These are build-time variables: change them, then rebuild the web image or restart `vite`.

### Network fees (gas)

USDC is the gas token on Arc. There are two ways to pay:

- **Sponsored (Circle Gas Station).** The user pays nothing. This is on by default on testnet. For mainnet, create a Gas Station **policy** in the Console first, otherwise account creation fails with error 155509. Then set `VITE_CIRCLE_SPONSOR_GAS=true`. A sponsor policy is a spending commitment on your side: set limits in the Console.
- **Not sponsored.** The smart account pays gas from its own USDC balance. The user must send USDC to the account address first.

### What to know before you ship it

- A passkey account has its own address, different from any browser wallet the user may have. Funds must be sent to that address.
- Each action asks for the fingerprint. An order that needs an approval first (approve, then create) shows two prompts, one per transaction.
- The credential is kept in `sessionStorage`, so closing the tab signs the user out and the next visit asks for the fingerprint again. This is deliberate: it keeps the credential out of long-lived storage.
- The browser must support WebAuthn and the page must be served over HTTPS (or `localhost`).
- Losing the device passkey without a synced passkey (iCloud Keychain, Google Password Manager, a password manager) means losing access to the account. Circle supports recovery with a mnemonic, which this app does not set up yet. Tell users to keep passkey sync on.
- Tested here: the provider and connector logic (unit tests), the dialog and the error messages. **Not tested here: a real passkey registration and a real sponsored transaction**, because they need your Circle Client Key and your domain. Run one on testnet before announcing it.

## 2. Agent chat model (OpenRouter, Gemini, OpenAI, or your own)

The Agent understands plain wording with built-in rules first, for free, in the browser. Only wording the rules cannot read goes to a model. The model sees only the user's message and token symbols. Whatever it answers must still pass the strict command parser, and every plan is read back and waits for a yes.

The admin chooses the model in the app: **Platform page, Agent chat model**. That needs a platform admin wallet (or `ADMIN_TOKEN`). You can also paste the keys on the same page (see below). There you pick a primary provider and model, and optionally a second one that is used only if the first fails or runs out of quota. Keys are never stored in the browser or in the config file: the page shows which providers have a key on the server and nothing else.

Add at least one key to the backend environment, or paste it on the Platform page (API keys panel), which stores it encrypted on the server when `SECRETS_ENCRYPTION_KEY` is set (see [platform-dashboard.md](platform-dashboard.md)):

```env
OPENROUTER_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
# Any other OpenAI-compatible server, for example a local Ollama:
# AGENT_LLM_URL=http://localhost:11434/v1
# AGENT_LLM_MODEL=llama3.2:3b
# AGENT_LLM_API_KEY=
# Hard cap on model calls per day across all users (default 2000)
# AGENT_LLM_DAILY_CALLS=2000
# Where the admin's choice is saved (default ./data). Mount a volume here.
# DATA_DIR=./data
```

Where to get them:

- **OpenRouter** (recommended, one key for many models): create an account at <https://openrouter.ai>, then **Keys** at <https://openrouter.ai/keys>. Models whose id ends in `:free` cost nothing and are rate-limited. The admin page lists the cheapest live models from OpenRouter's own catalogue.
- **Google Gemini**: <https://aistudio.google.com/apikey>. The free tier has daily limits.
- **OpenAI**: <https://platform.openai.com/api-keys>. Paid per use, with no free tier. Small models (`gpt-4.1-nano`, `gpt-4o-mini`) cost a fraction of a cent per message.

Suggested setup that costs nothing: primary Gemini 2.5 Flash Lite (free tier), fallback an OpenRouter `:free` model. Prices and free quotas change; check the provider's page.

If no key is set, or the admin turns the model off, the Agent still works with the built-in rules. The old `AGENT_LLM_*` variables keep working as the "Custom" provider.

## 3. Prices, charts and the token list (no key)

| Data | Source | Key |
| --- | --- | --- |
| Token list and swap quotes on Arc mainnet | KyberSwap aggregator | none |
| Extra swap quotes | 0x Swap API | `ZEROEX_API_KEY` (optional) |
| Price, 24h change, volume, liquidity, best pool | DexScreener | none |
| Candles for any token with a pool | GeckoTerminal | none |
| BTC, ETH, EURC reference candles | Coinbase Exchange | none |

All of these are called by the backend, never by the browser, and cached and coalesced per pair so many visitors cost the same as one. GeckoTerminal allows roughly 30 calls a minute; the backend keeps to `GECKO_CALLS_PER_MIN` (default 24) and serves cached candles when the budget is used up.

A token appears in the picker when the aggregator can route it. It gets a chart only when a liquid pool exists on a DEX that DexScreener indexes. Tokens with no such pool show the aggregator quote and a clear "no chart data" message instead of a fake chart. Placing conditional orders also needs a price feed for the token on the contract (see the feed list in `docs/configuration.md`).

To get the 0x key: <https://dashboard.0x.org>, create an app, copy the API key. 0x lists Arc mainnet only, so it does nothing on testnet.

## 4. RPC endpoints

The public Arc RPC works but rate-limits. For production use a provider that serves Arc and set several URLs, tried in order:

```env
VITE_RPC_URL_ARC=https://primary.example,https://backup.example
RPC_URL_Arc=https://primary.example,https://backup.example
```

Browser variables are public, so use a key that is restricted to your domain, or a URL that carries no secret.

## 5. Other backend settings you will want

- `ADMIN_TOKEN`: any long random string. It protects the admin routes. Generate with `bun scripts/coolify/gen-env.ts`.
- `KEEPER_PRIVATE_KEY`: a dedicated low-balance key for the keeper. Never reuse a key that holds funds.
- `PLATFORM_FEE_BPS` and `PLATFORM_FEE_RECIPIENT`: optional fee on market swaps (max 100 bps).

See `.env.example` for every variable and `docs/configuration.md` for what each one does.
