import { normalizePhoneE164, toProviderPhone } from '@/utils/phone'

const PHONE_HEADER_ALIASES = new Set([
  'phone',
  'mobile',
  'whatsapp',
  'notipon',
  'notelefon',
  'telefon',
  'tel',
  'hp',
])

const NAME_HEADER_ALIASES = new Set([
  'name',
  'payname',
  'customername',
  'nama',
])

const MALAYSIAN_WHATSAPP_DIGITS_REGEX = /^601\d{7,9}$/

export type ParsedRecipientStatus = 'eligible' | 'excluded'
export type ParsedRecipientReason = 'invalid_phone' | 'duplicate' | 'missing_phone' | 'not_whatsapp_format'

export type ParsedRecipient = {
  id: string
  source: 'manual_adhoc'
  name: string | null
  display_name: string
  phone_raw: string
  phone_normalized: string | null
  whatsapp_number: string | null
  phone_e164: string | null
  status: ParsedRecipientStatus
  reason: ParsedRecipientReason | null
  validation_status: 'valid' | 'invalid'
  validation_reason: ParsedRecipientReason | null
  metadata: {
    row_index: number
    column_index: number | null
    import_format: 'list' | 'table' | 'stored'
  }
}

type ParsedPhoneResult = {
  phoneE164: string | null
  phoneDigits: string | null
  reason: ParsedRecipientReason | null
  valid: boolean
}

type ParsedRow = {
  existingId?: string | null
  name: string | null
  phoneRaw: string
  rowIndex: number
  columnIndex: number | null
  importFormat: 'list' | 'table' | 'stored'
}

type StoredAdhocRecipientLike = Partial<ParsedRecipient> & {
  phone?: string | null
  display_name?: string | null
}

function cleanCell(value: unknown): string {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim()
}

function normalizeHeader(value: string): string {
  return cleanCell(value).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeMalaysianWhatsAppPhone(value: string): ParsedPhoneResult {
  const phoneRaw = cleanCell(value)
  if (!phoneRaw) {
    return {
      phoneE164: null,
      phoneDigits: null,
      reason: 'missing_phone',
      valid: false,
    }
  }

  const digitsOnly = phoneRaw.replace(/\D/g, '')
  if (!digitsOnly) {
    return {
      phoneE164: null,
      phoneDigits: null,
      reason: 'invalid_phone',
      valid: false,
    }
  }

  const phoneE164 = normalizePhoneE164(phoneRaw)
  const phoneDigits = toProviderPhone(phoneRaw)

  if (!phoneE164 || !phoneDigits) {
    return {
      phoneE164: null,
      phoneDigits: null,
      reason: 'invalid_phone',
      valid: false,
    }
  }

  if (!MALAYSIAN_WHATSAPP_DIGITS_REGEX.test(phoneDigits)) {
    return {
      phoneE164,
      phoneDigits,
      reason: 'not_whatsapp_format',
      valid: false,
    }
  }

  return {
    phoneE164,
    phoneDigits,
    reason: null,
    valid: true,
  }
}

function buildParsedRecipient(parsedRow: ParsedRow): ParsedRecipient {
  const normalizedPhone = normalizeMalaysianWhatsAppPhone(parsedRow.phoneRaw)
  const displayPhone = normalizedPhone.phoneDigits || parsedRow.phoneRaw || `Recipient ${parsedRow.rowIndex + 1}`
  const displayName = parsedRow.name || displayPhone

  return {
    id: parsedRow.existingId || `manual_adhoc_${parsedRow.rowIndex}_${normalizedPhone.phoneDigits || parsedRow.phoneRaw.replace(/\W+/g, '_') || 'unknown'}`,
    source: 'manual_adhoc',
    name: parsedRow.name,
    display_name: displayName,
    phone_raw: parsedRow.phoneRaw,
    phone_normalized: normalizedPhone.phoneDigits,
    whatsapp_number: normalizedPhone.phoneDigits,
    phone_e164: normalizedPhone.phoneE164,
    status: normalizedPhone.valid ? 'eligible' : 'excluded',
    reason: normalizedPhone.reason,
    validation_status: normalizedPhone.valid ? 'valid' : 'invalid',
    validation_reason: normalizedPhone.reason,
    metadata: {
      row_index: parsedRow.rowIndex,
      column_index: parsedRow.columnIndex,
      import_format: parsedRow.importFormat,
    },
  }
}

function applyDuplicateExclusions(recipients: ParsedRecipient[]): ParsedRecipient[] {
  const seenPhones = new Set<string>()

  return recipients.map((recipient) => {
    if (recipient.status !== 'eligible' || !recipient.phone_normalized) {
      return recipient
    }

    if (seenPhones.has(recipient.phone_normalized)) {
      return {
        ...recipient,
        status: 'excluded',
        reason: 'duplicate',
        validation_status: 'invalid',
        validation_reason: 'duplicate',
      }
    }

    seenPhones.add(recipient.phone_normalized)
    return recipient
  })
}

function findPhoneHeaderIndex(cells: string[]): number {
  return cells.findIndex((cell) => PHONE_HEADER_ALIASES.has(normalizeHeader(cell)))
}

function findNameHeaderIndex(cells: string[]): number {
  return cells.findIndex((cell) => NAME_HEADER_ALIASES.has(normalizeHeader(cell)))
}

function findFirstValidPhoneCell(cells: string[]): { index: number; value: string } | null {
  for (let index = 0; index < cells.length; index += 1) {
    const value = cleanCell(cells[index])
    if (!value) continue

    const normalized = normalizeMalaysianWhatsAppPhone(value)
    if (normalized.valid) {
      return { index, value }
    }
  }

  return null
}

function findFallbackPhoneCell(cells: string[]): { index: number | null; value: string } {
  const digitCandidates = cells
    .map((value, index) => ({ index, value: cleanCell(value) }))
    .filter((candidate) => candidate.value)
    .sort((left, right) => {
      const rightDigits = right.value.replace(/\D/g, '').length
      const leftDigits = left.value.replace(/\D/g, '').length
      return rightDigits - leftDigits
    })

  if (digitCandidates.length === 0) {
    return { index: null, value: '' }
  }

  return {
    index: digitCandidates[0]?.index ?? null,
    value: digitCandidates[0]?.value ?? '',
  }
}

function detectNameWithoutHeaders(cells: string[], phoneIndex: number | null): string | null {
  for (let index = 0; index < cells.length; index += 1) {
    if (index === phoneIndex) continue

    const value = cleanCell(cells[index])
    if (!value) continue
    if (/\d/.test(value)) continue
    return value
  }

  return null
}

function parseTabularInput(input: string): ParsedRecipient[] {
  const rows = input
    .split(/\r?\n/)
    .map((line) => line.split('\t').map((cell) => cleanCell(cell)))
    .filter((row) => row.some((cell) => cell))

  if (rows.length === 0) {
    return []
  }

  const phoneHeaderIndex = findPhoneHeaderIndex(rows[0] || [])
  const nameHeaderIndex = findNameHeaderIndex(rows[0] || [])
  const hasHeaderRow = phoneHeaderIndex >= 0

  const dataRows = hasHeaderRow ? rows.slice(1) : rows

  return applyDuplicateExclusions(
    dataRows.map((row, rowIndex) => {
      const phoneCell = phoneHeaderIndex >= 0
        ? {
          index: phoneHeaderIndex,
          value: cleanCell(row[phoneHeaderIndex] || ''),
        }
        : findFirstValidPhoneCell(row) || findFallbackPhoneCell(row)

      const name = nameHeaderIndex >= 0
        ? cleanCell(row[nameHeaderIndex] || '') || null
        : detectNameWithoutHeaders(row, phoneCell.index)

      return buildParsedRecipient({
        name,
        phoneRaw: phoneCell.value,
        rowIndex,
        columnIndex: phoneCell.index,
        importFormat: 'table',
      })
    }),
  )
}

function parseListInput(input: string): ParsedRecipient[] {
  const tokens = input
    .split(/[\s,;]+/)
    .map((token) => cleanCell(token))
    .filter(Boolean)

  if (tokens.length === 0) {
    return []
  }

  const filteredTokens = PHONE_HEADER_ALIASES.has(normalizeHeader(tokens[0] || ''))
    ? tokens.slice(1)
    : tokens

  return applyDuplicateExclusions(
    filteredTokens.map((token, rowIndex) => buildParsedRecipient({
      name: null,
      phoneRaw: token,
      rowIndex,
      columnIndex: 0,
      importFormat: 'list',
    })),
  )
}

export function parseAdhocWhatsAppRecipients(input: string): ParsedRecipient[] {
  const trimmedInput = cleanCell(input)
  if (!trimmedInput) {
    return []
  }

  const looksTabular = trimmedInput.includes('\t') || trimmedInput.includes('\n') || trimmedInput.includes('\r')
  return looksTabular ? parseTabularInput(trimmedInput) : parseListInput(trimmedInput)
}

export function normalizeAdhocRecipientList(input: unknown): ParsedRecipient[] {
  if (!Array.isArray(input)) {
    return []
  }

  return applyDuplicateExclusions(
    input.flatMap((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return []
      }

      const value = entry as StoredAdhocRecipientLike
      const phoneRaw = cleanCell(
        value.phone_raw ||
        value.phone ||
        value.phone_e164 ||
        value.phone_normalized ||
        value.whatsapp_number ||
        '',
      )

      const name = cleanCell(value.name || value.display_name || '') || null

      return [buildParsedRecipient({
        existingId: value.id,
        name,
        phoneRaw,
        rowIndex: typeof value.metadata?.row_index === 'number' ? value.metadata.row_index : index,
        columnIndex: typeof value.metadata?.column_index === 'number' ? value.metadata.column_index : null,
        importFormat: 'stored',
      })]
    }),
  )
}

export function summarizeAdhocRecipients(recipients: ParsedRecipient[]) {
  const eligible = recipients.filter((recipient) => recipient.status === 'eligible').length
  const duplicate = recipients.filter((recipient) => recipient.reason === 'duplicate').length
  const invalid = recipients.filter((recipient) => recipient.reason === 'invalid_phone' || recipient.reason === 'missing_phone' || recipient.reason === 'not_whatsapp_format').length

  return {
    total: recipients.length,
    eligible,
    excluded: recipients.length - eligible,
    duplicate,
    invalid,
  }
}