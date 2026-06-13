export function formatStorefrontError(error: unknown) {
  if (error == null) {
    return { message: 'Unknown error' }
  }

  const record = typeof error === 'object' ? (error as Record<string, unknown>) : {}
  const cause = record.cause
  const causeMessage =
    typeof cause === 'string'
      ? cause
      : cause && typeof cause === 'object' && typeof (cause as { message?: unknown }).message === 'string'
        ? String((cause as { message: string }).message)
        : undefined

  return {
    name: typeof record.name === 'string' ? record.name : error instanceof Error ? error.name : undefined,
    message: typeof record.message === 'string' ? record.message : error instanceof Error ? error.message : String(error),
    code:
      typeof record.code === 'string' || typeof record.code === 'number'
        ? String(record.code)
        : undefined,
    details: typeof record.details === 'string' ? record.details : undefined,
    hint: typeof record.hint === 'string' ? record.hint : undefined,
    causeMessage,
  }
}