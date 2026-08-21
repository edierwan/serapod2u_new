import { describe, expect, it } from 'vitest'
import {
  detectChatIntent,
  looksLikeOrderList,
  quickRepliesForPhase,
  SERAPP_SAMPLE_LIST,
  shouldRouteToSerappAi,
  shouldRunSerappBot,
} from '@/lib/serapp/chat-bot'
import { DEFAULT_SESSION } from '@/lib/serapp/conversation-types'

describe('looksLikeOrderList', () => {
  it('detects HERO/ZERO paste lists', () => {
    const text = `HERO
BANANA VANILLA - 100
GUAVA - 200
ZERO
ALMOND - 100`
    expect(looksLikeOrderList(text)).toBe(true)
  })

  it('rejects short chat phrases', () => {
    expect(looksLikeOrderList('confirm')).toBe(false)
    expect(looksLikeOrderList('hello')).toBe(false)
  })

  it('accepts a single qty line', () => {
    expect(looksLikeOrderList('BANANA VANILLA - 100')).toBe(true)
  })
})

describe('detectChatIntent', () => {
  it('maps confirm / help / new order', () => {
    expect(detectChatIntent('confirm').type).toBe('confirm')
    expect(detectChatIntent('help').type).toBe('help')
    expect(detectChatIntent('new order').type).toBe('new_order')
    expect(detectChatIntent('repeat').type).toBe('repeat_last')
    expect(detectChatIntent('cancel hold').type).toBe('cancel_hold')
  })

  it('maps paste lists to order_list', () => {
    const intent = detectChatIntent('HERO\nTEA - 50')
    expect(intent.type).toBe('order_list')
    if (intent.type === 'order_list') {
      expect(intent.pasteText).toContain('TEA')
    }
  })

  it('maps casual single-line orders to order_list', () => {
    const intent = detectChatIntent('banana vanilla 100')
    expect(intent.type).toBe('order_list')
    if (intent.type === 'order_list') {
      expect(intent.pasteText).toBe('banana vanilla - 100')
    }
  })

  it('maps stock questions to product_inquiry', () => {
    expect(detectChatIntent('do you have guava')).toEqual({
      type: 'product_inquiry',
      query: 'guava',
    })
    expect(detectChatIntent('ada stok mango tak')).toEqual({
      type: 'product_inquiry',
      query: 'mango',
    })
  })

  it('treats intent-only words as incomplete_intent', () => {
    expect(detectChatIntent('بدي')).toEqual({ type: 'incomplete_intent' })
    expect(detectChatIntent('nak')).toEqual({ type: 'incomplete_intent' })
  })

  it('keeps sample paste lists on the fast rules path', () => {
    const sample = SERAPP_SAMPLE_LIST
    const intent = detectChatIntent(sample)
    expect(intent.type).toBe('order_list')
    expect(shouldRouteToSerappAi(intent)).toBe(false)
  })

  it('routes product questions to AI when enabled', () => {
    expect(shouldRouteToSerappAi(detectChatIntent('banana'))).toBe(true)
    expect(shouldRouteToSerappAi(detectChatIntent('ada stok mango tak'))).toBe(true)
  })
})

describe('quickRepliesForPhase', () => {
  it('offers confirm after available check', () => {
    const replies = quickRepliesForPhase('checked', 'available')
    expect(replies.some((r) => r.id === 'confirm')).toBe(true)
  })

  it('hides confirm when review needed', () => {
    const replies = quickRepliesForPhase('checked', 'unmatched_or_review')
    expect(replies.some((r) => r.id === 'confirm')).toBe(false)
  })

  it('does not offer Repeat last list', () => {
    for (const phase of ['idle', 'awaiting_list', 'checked', 'confirmed'] as const) {
      const replies = quickRepliesForPhase(phase, 'available')
      expect(replies.some((r) => r.id === 'repeat')).toBe(false)
    }
  })
})

describe('shouldRunSerappBot', () => {
  it('skips bot for HQ and opens human handoff', () => {
    const result = shouldRunSerappBot({
      isHqSender: true,
      text: 'Yes, it is right',
      session: { ...DEFAULT_SESSION },
    })
    expect(result.run).toBe(false)
    expect(result.session.humanHandoff).toBe(true)
  })

  it('stays silent for casual chat after handoff', () => {
    const result = shouldRunSerappBot({
      isHqSender: false,
      text: 'Yes, it is right',
      session: { ...DEFAULT_SESSION, humanHandoff: true },
    })
    expect(result.run).toBe(false)
  })

  it('still answers order commands after handoff', () => {
    const help = shouldRunSerappBot({
      isHqSender: false,
      text: 'help',
      session: { ...DEFAULT_SESSION, humanHandoff: true },
    })
    expect(help.run).toBe(true)

    const paste = shouldRunSerappBot({
      isHqSender: false,
      text: 'CV - 50',
      session: { ...DEFAULT_SESSION, humanHandoff: true },
    })
    expect(paste.run).toBe(true)

    const stockAsk = shouldRunSerappBot({
      isHqSender: false,
      text: 'ada stok mango',
      session: { ...DEFAULT_SESSION, humanHandoff: true },
    })
    expect(stockAsk.run).toBe(true)

    const confirmReady = shouldRunSerappBot({
      isHqSender: false,
      text: 'confirm',
      session: { ...DEFAULT_SESSION, humanHandoff: true, phase: 'checked' },
    })
    expect(confirmReady.run).toBe(true)

    const confirmTooEarly = shouldRunSerappBot({
      isHqSender: false,
      text: 'yes',
      session: { ...DEFAULT_SESSION, humanHandoff: true, phase: 'awaiting_list' },
    })
    expect(confirmTooEarly.run).toBe(false)
  })
})
