/**
 * wagmi configuration
 */

import { fallback, http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc, arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { getChain } from './onchain-facts'
import { circleEnabled } from './wallet/circle'
import { circlePasskey } from './wallet/circleConnector'

/**
 * RPC URLs for a chain: VITE_RPC_URL_ARC_TESTNET / VITE_RPC_URL_ARC (comma-separated, tried in order) win over
 * the public endpoint from the chain facts. The public endpoint rate-limits, so a deployment should set its own.
 */
function rpcUrls(custom: string | undefined, fromFacts: string | undefined, viemDefault: string): string[] {
  const own = (custom ?? '').split(',').map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s))
  return own.length ? own : [fromFacts ?? viemDefault]
}

/** JSON-RPC batching turns the many small reads a page makes into a few requests, which keeps rate limits away. */
function transportFor(urls: string[]) {
  const one = (u: string) => http(u, { batch: { wait: 25, batchSize: 50 }, retryCount: 2, retryDelay: 400, timeout: 12_000 })
  return urls.length > 1 ? fallback(urls.map(one), { rank: false }) : one(urls[0])
}

const env = import.meta.env
const testnetUrls = rpcUrls(env.VITE_RPC_URL_ARC_TESTNET, getChain(arcTestnet.id)?.rpcUrls[0], arcTestnet.rpcUrls.default.http[0])
const mainnetUrls = rpcUrls(env.VITE_RPC_URL_ARC, getChain(arc.id)?.rpcUrls[0], arc.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [arcTestnet, arc, mainnet], // Ethereum mainnet is only needed for ENS resolution
  // The passkey wallet is offered only when the operator has set a Circle Client Key. Browser wallets always work.
  connectors: [injected(), ...(circleEnabled ? [circlePasskey({ rpcUrls: { [arcTestnet.id]: testnetUrls[0], [arc.id]: mainnetUrls[0] } })] : [])],
  // viem splits a multicall into requests of at most 1 KB of calldata by default, so one table refresh became
  // four or five requests. 16 KB keeps each refresh to a single request.
  batch: { multicall: { batchSize: 16_384, wait: 25 } },
  transports: {
    [arcTestnet.id]: transportFor(testnetUrls),
    [arc.id]: transportFor(mainnetUrls),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
