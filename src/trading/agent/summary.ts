/**
 * Turns a parsed command into labelled fields for display: the "interpreted strategy" the user checks before any
 * plan is built. Pure and free of network access, so the same view works in the Agent, before a wallet is connected,
 * and on the landing page. It shows what the parser understood, never a price or a quote.
 */
import type { Amount, Frequency, Intent } from './parser'

export interface IntentView {
  /** Short name of the order type, for a heading or a tag. */
  label: string
  fields: [string, string][]
}

const FREQ_LABEL: Record<Frequency, string> = { hourly: 'Every hour', daily: 'Every day', weekly: 'Every week', monthly: 'Every month' }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Shows a token the way the list spells it (tETH, cirBTC) when it is known, and otherwise as typed. */
function symbolizer(known: readonly string[]) {
  return (t: string) => known.find((k) => k.toLowerCase() === t.toLowerCase()) ?? (/^0x/i.test(t) ? `${t.slice(0, 6)}...${t.slice(-4)}` : t.length <= 5 ? t.toUpperCase() : cap(t))
}

function amountText(a: Amount, token: string, sym: (t: string) => string): string {
  switch (a.kind) {
    case 'usdc':
      return `${a.value} USDC`
    case 'token':
      return `${a.value} ${sym(token)}`
    case 'percent':
      return `${a.value}% of your ${sym(token)}`
    case 'all':
      return `All of your ${sym(token)}`
  }
}

export function describeIntent(i: Intent, knownSymbols: readonly string[] = []): IntentView | null {
  const sym = symbolizer(knownSymbols)
  const amount = (a: Amount, token: string) => amountText(a, token, sym)
  switch (i.kind) {
    case 'swap':
      return { label: `Market ${i.side}`, fields: [['Order type', 'Market'], ['Side', cap(i.side)], ['Token', sym(i.token)], [i.side === 'buy' ? 'Spend' : 'Sell', amount(i.amount, i.token)]] }
    case 'limit':
      return { label: `Limit ${i.side}`, fields: [['Order type', 'Limit'], ['Side', cap(i.side)], ['Token', sym(i.token)], [i.side === 'buy' ? 'Spend' : 'Sell', amount(i.amount, i.token)], ['Fills at', i.price]] }
    case 'stop_loss':
      return { label: 'Stop-loss', fields: [['Order type', 'Stop-loss'], ['Side', 'Sell'], ['Token', sym(i.token)], ['Sell', amount(i.amount, i.token)], ['Triggers at', i.price]] }
    case 'take_profit':
      return { label: 'Take-profit', fields: [['Order type', 'Take-profit'], ['Side', 'Sell'], ['Token', sym(i.token)], ['Sell', amount(i.amount, i.token)], ['Triggers at', i.price]] }
    case 'stop_limit':
      return { label: 'Stop-limit', fields: [['Order type', 'Stop-limit'], ['Side', 'Sell'], ['Token', sym(i.token)], ['Sell', amount(i.amount, i.token)], ['Stop price', i.stop], ['Limit price', i.limit]] }
    case 'trailing':
      return { label: 'Trailing stop', fields: [['Order type', 'Trailing stop'], ['Side', 'Sell'], ['Token', sym(i.token)], ['Sell', amount(i.amount, i.token)], ['Trails by', `${i.trailPct}%`]] }
    case 'oco':
      return { label: 'OCO', fields: [['Order type', 'OCO'], ['Side', 'Sell'], ['Token', sym(i.token)], ['Sell', amount(i.amount, i.token)], ['Stop-loss', i.stop], ['Take-profit', i.take]] }
    case 'dca': {
      const fields: [string, string][] = [['Order type', 'DCA'], ['Side', 'Buy'], ['Token', sym(i.token)], ['Each buy', `${i.perBuy} USDC`], ['Schedule', FREQ_LABEL[i.frequency]], ['Length', `${i.days} ${i.days === 1 ? 'day' : 'days'}`]]
      if (i.cap) fields.push(['Skips buys above', i.cap])
      return { label: 'DCA', fields }
    }
    case 'cancel_order':
      return { label: 'Cancel order', fields: [['Action', 'Cancel order'], ['Order', `#${i.id}`]] }
    case 'manage_dca':
      return { label: `${cap(i.action)} DCA`, fields: [['Action', `${cap(i.action)} DCA plan`], ['Plan', `#${i.id}`]] }
    default:
      return null
  }
}
