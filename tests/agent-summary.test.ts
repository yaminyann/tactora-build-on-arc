import { describe, expect, test } from 'bun:test'
import { parseCommand } from '../src/trading/agent/parser'
import { describeIntent } from '../src/trading/agent/summary'
import { interpretChat, type ChatContext } from '../src/trading/agent/chat'

const ctx: ChatContext = {
  tokens: [
    { symbol: 'ETH', name: 'Ether' },
    { symbol: 'BTC', name: 'Bitcoin' },
  ],
  quote: 'USDC',
  connected: false,
  holdings: [],
  prices: { ETH: 3000, BTC: 90000 },
  freeQuote: 0,
  protectedSymbols: [],
  activeDca: 0,
}

const view = (text: string, known: string[] = ['ETH', 'tETH']) => {
  const p = parseCommand(text)
  if (!p.ok) throw new Error(p.error)
  return describeIntent(p.intent, known)
}

describe('strategy summary', () => {
  test('shows every parameter of each order type', () => {
    expect(view('limit buy ETH 100 USDC at 2850')).toEqual({
      label: 'Limit buy',
      fields: [['Order type', 'Limit'], ['Side', 'Buy'], ['Token', 'ETH'], ['Spend', '100 USDC'], ['Fills at', '2850']],
    })
    expect(view('oco all ETH sl 2800 tp 3300')?.fields).toEqual([['Order type', 'OCO'], ['Side', 'Sell'], ['Token', 'ETH'], ['Sell', 'All of your ETH'], ['Stop-loss', '2800'], ['Take-profit', '3300']])
    expect(view('stop limit 0.5 ETH stop 2800 limit 2750')?.fields.map(([k]) => k)).toEqual(['Order type', 'Side', 'Token', 'Sell', 'Stop price', 'Limit price'])
    expect(view('trailing stop 50% ETH 5%')?.fields).toContainEqual(['Trails by', '5%'])
    expect(view('take profit 0.1 ETH at 3500')?.fields).toContainEqual(['Triggers at', '3500'])
    expect(view('buy 10 USDC of ETH')?.label).toBe('Market buy')
    expect(view('sell 50% of ETH')?.fields).toContainEqual(['Sell', '50% of your ETH'])
  })

  test('describes a DCA plan with its schedule and length', () => {
    expect(view('dca 71.42 USDC into ETH daily for 7 days')?.fields).toEqual([['Order type', 'DCA'], ['Side', 'Buy'], ['Token', 'ETH'], ['Each buy', '71.42 USDC'], ['Schedule', 'Every day'], ['Length', '7 days']])
    expect(view('dca 1 USDC into ETH daily for 1 days')?.fields).toContainEqual(['Length', '1 day'])
  })

  test('spells a token the way the list does, and is silent on lookups', () => {
    expect(view('buy 10 USDC of teth', ['tETH'])?.fields).toContainEqual(['Token', 'tETH'])
    expect(view('cancel order 12')?.fields).toEqual([['Action', 'Cancel order'], ['Order', '#12']])
    expect(view('pause dca 3')?.label).toBe('Pause DCA')
    const p = parseCommand('balance')
    expect(p.ok && describeIntent(p.intent)).toBeNull()
  })
})

describe('chat rules added for the Agent examples', () => {
  const command = (t: string) => {
    const r = interpretChat(t, ctx)
    return r.kind === 'command' ? r.command : r
  }

  test('a total DCA budget over a number of days becomes daily buys, with the arithmetic said', () => {
    const r = interpretChat('DCA $500 into ETH over the next 7 days', ctx)
    expect(r.kind).toBe('command')
    if (r.kind === 'command') {
      expect(r.command).toBe('dca 71.42 USDC into ETH daily for 7 days')
      expect(r.note).toContain('total budget')
      expect(r.note).toContain('499.94')
    }
  })

  test('a DCA with no amount or schedule asks instead of guessing', () => {
    const r = interpretChat('dca into eth', ctx)
    expect(r.kind).toBe('reply')
    if (r.kind === 'reply') expect(r.text).toContain('How often')
  })

  test('an OCO with no levels asks for them and offers usual ones at the known price', () => {
    const r = interpretChat('Create an OCO for ETH', ctx)
    expect(r.kind).toBe('reply')
    if (r.kind === 'reply') {
      expect(r.text).toContain('stop-loss')
      expect(r.suggestions?.[0].command).toBe('oco all ETH sl 2850 tp 3300')
    }
    const noToken = interpretChat('Create an OCO order with two price levels', ctx)
    expect(noToken.kind).toBe('reply')
  })

  test('the dip-buy example reads as a limit buy five percent below the price', () => {
    expect(command('Buy $100 worth of ETH when the price drops 5%')).toBe('limit buy ETH 100 USDC at 2850')
  })

  test('an OCO with two levels still reads as before', () => {
    expect(command('sell all ETH if it falls to 2700 or rises to 3300')).toBe('oco all ETH sl 2700 tp 3300')
  })
})
