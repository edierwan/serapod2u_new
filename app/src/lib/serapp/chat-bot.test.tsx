import { describe, expect, it } from 'vitest'
import {
  detectChatIntent,
  looksLikeOrderList,
  quickRepliesForPhase,
} from '@/lib/serapp/chat-bot'

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
})
