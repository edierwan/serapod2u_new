const ACTION_PREFIX = 'SERAPP_ACTION:'

export type SerappAiAction =
  | { action: 'chat' }
  | { action: 'help' }
  | { action: 'new_order' }
  | { action: 'confirm' }
  | { action: 'cancel_hold' }
  | { action: 'check_stock'; pasteText: string }
  | { action: 'search_catalog'; query: string }

export function parseSerappAiAction(raw: string): { reply: string; action: SerappAiAction | null } {
  const match = raw.match(/SERAPP_ACTION:\s*(\{[\s\S]*?\})\s*$/m)
  if (!match) {
    return { reply: raw.trim(), action: null }
  }

  const reply = raw.slice(0, match.index).trim()
  try {
    const parsed = JSON.parse(match[1]) as SerappAiAction
    if (!parsed?.action) return { reply: raw.trim(), action: null }
    return { reply: reply || raw.replace(match[0], '').trim(), action: parsed }
  } catch {
    return { reply: raw.trim(), action: null }
  }
}

export { ACTION_PREFIX }
