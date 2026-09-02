import { describe, expect, it } from 'vitest'
import {
  canShowSerappConfirmButton,
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

  it('accepts manager-style WhatsApp lists with bullets and status emojis', () => {
    const bulletList = [
      '* Vanilla Tobacco -5✅',
      '* Strawberry Pudina (Pink) -',
      '* Teh (Tarik) -5✅',
      'LYCHEE BLACKCURRANT-5✅',
    ].join('\n')
    expect(looksLikeOrderList(bulletList)).toBe(true)
    expect(detectChatIntent(bulletList).type).toBe('order_list')

    const managerList = [
      'nfy Tech',
      'Serapod',
      'Vanilla Tobacco- 200✅',
      'Strawberry (Yellow) -600❌',
      'Vanilla Brown -',
      'Cellera Zero',
      'Grape Ice - 50✅',
      'total=3250(cases)',
    ].join('\n')
    expect(looksLikeOrderList(managerList)).toBe(true)
    expect(detectChatIntent(managerList).type).toBe('order_list')
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

  it('does not treat ok/yes as confirm', () => {
    expect(detectChatIntent('ok').type).toBe('ack')
    expect(detectChatIntent('okay').type).toBe('ack')
    expect(detectChatIntent('yes').type).toBe('ack')
    expect(detectChatIntent('confirm').type).toBe('confirm')
    expect(detectChatIntent('sahkan').type).toBe('confirm')
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
      expect(intent.pasteText).toContain('banana vanilla')
      expect(intent.pasteText).toContain('100')
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
    expect(detectChatIntent('CV')).toEqual({
      type: 'product_inquiry',
      query: 'CV',
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

  it('hides cancel hold when session has no active submitted order', () => {
    const replies = quickRepliesForPhase('confirmed', null, null, {
      phase: 'confirmed',
      pendingPasteText: null,
      lastCheck: null,
      lastConfirm: {
        orderId: 'ord-1',
        orderNo: 'SO1',
        status: 'cancelled',
        confirmedLines: 1,
        skippedLines: 0,
        estimatedOrderValue: 0,
      },
      distributorId: null,
      lineResolutions: [],
      quantityResolutions: [],
      humanHandoff: false,
    })
    expect(replies.some((r) => r.id === 'cancel')).toBe(false)
    expect(replies.some((r) => r.id === 'sample')).toBe(true)
  })

  it('shows cancel hold only for submitted confirmed orders', () => {
    const replies = quickRepliesForPhase('confirmed', null, null, {
      phase: 'confirmed',
      pendingPasteText: null,
      lastCheck: null,
      lastConfirm: {
        orderId: 'ord-1',
        orderNo: 'SO1',
        status: 'submitted',
        confirmedLines: 1,
        skippedLines: 0,
        estimatedOrderValue: 0,
      },
      distributorId: null,
      lineResolutions: [],
      quantityResolutions: [],
      humanHandoff: false,
    })
    expect(replies.some((r) => r.id === 'cancel')).toBe(true)
  })
})

describe('canShowSerappConfirmButton', () => {
  it('shows confirm when partially available and no blocking lines', () => {
    expect(canShowSerappConfirmButton(
      { bucket: 'partially_available', label: 'Partially Available' } as never,
      [
        { status: 'matched', selectedVariantId: 'a', quantity: 5, inventoryOutcome: 'matched' },
        { status: 'matched', selectedVariantId: 'b', quantity: 5, inventoryOutcome: 'no_available_stock' },
      ] as never,
    )).toBe(true)
  })

  it('shows confirm when some lines are out of stock but others are orderable', () => {
    expect(canShowSerappConfirmButton(
      { bucket: 'unmatched_or_review', label: 'Unmatched / Requires Review' } as never,
      [
        { status: 'matched', selectedVariantId: 'a', quantity: 10, inventoryOutcome: 'matched' },
        { status: 'not_found', selectedVariantId: undefined, quantity: 5 },
        { status: 'matched', selectedVariantId: 'b', quantity: 5, inventoryOutcome: 'no_available_stock' },
      ] as never,
    )).toBe(true)
  })

  it('hides confirm while quantity is still missing', () => {
    expect(canShowSerappConfirmButton(
      { bucket: 'partially_available', label: 'Partially Available' } as never,
      [
        { status: 'matched', selectedVariantId: 'a', quantity: 5, inventoryOutcome: 'matched' },
        { status: 'missing_quantity', selectedVariantId: 'b' },
      ] as never,
    )).toBe(false)
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
      text: 'confirm',
      session: { ...DEFAULT_SESSION, humanHandoff: true, phase: 'awaiting_list' },
    })
    expect(confirmTooEarly.run).toBe(false)

    const ackNudge = shouldRunSerappBot({
      isHqSender: false,
      text: 'yes',
      session: { ...DEFAULT_SESSION, humanHandoff: true, phase: 'awaiting_list' },
    })
    expect(ackNudge.run).toBe(true)
  })
})
