import { describe, expect, it } from 'vitest'
import { parseSerappAiAction } from './serapp-ai-parse'

describe('parseSerappAiAction', () => {
  it('extracts check_stock action from AI reply', () => {
    const raw = `Sure — checking banana for you.\nSERAPP_ACTION:{"action":"check_stock","pasteText":"BANANA VANILLA - 100"}`
    const parsed = parseSerappAiAction(raw)
    expect(parsed.reply).toContain('Sure')
    expect(parsed.action).toEqual({
      action: 'check_stock',
      pasteText: 'BANANA VANILLA - 100',
    })
  })

  it('returns plain chat when no action line', () => {
    expect(parseSerappAiAction('Hello! What would you like to order?')).toEqual({
      reply: 'Hello! What would you like to order?',
      action: null,
    })
  })
})
