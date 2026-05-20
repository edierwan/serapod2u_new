export const PERSONAL_CASHBACK_BANK_ERROR = 'Please save a valid personal bank account before redeeming cashback.'

type NullableText = string | null | undefined

type JoinedBank = {
  id?: string | null
  short_name?: string | null
} | null | undefined

export type MsiaBankRule = {
  id: string
  short_name?: string | null
  min_account_length?: number | null
  max_account_length?: number | null
  is_numeric_only?: boolean | null
  is_active?: boolean | null
}

export type PersonalBankDetails = {
  bankId: string | null
  bankName: string | null
  bankAccountNumber: string | null
  bankAccountHolderName: string | null
}

type UserBankProfile = {
  bank_id?: NullableText
  bank_account_number?: NullableText
  bank_account_holder_name?: NullableText
  msia_banks?: JoinedBank | JoinedBank[]
}

type PersonalBankUpdateInput = {
  bankId?: NullableText
  bankAccountNumber?: NullableText
  bankAccountHolderName?: NullableText
}

type CashbackBankValidationInput = {
  bankId?: NullableText
  bankAccountNumber?: NullableText
  bank?: MsiaBankRule | null
}

function normalizeNullableText(value: NullableText): string | null {
  if (typeof value !== 'string') {
    return value ?? null
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function unwrapJoinedBank(bank: JoinedBank | JoinedBank[]): JoinedBank {
  if (Array.isArray(bank)) {
    return bank[0] ?? null
  }

  return bank ?? null
}

export function resolveMobilePersonalBankDetails(userProfile: UserBankProfile): PersonalBankDetails {
  const bank = unwrapJoinedBank(userProfile.msia_banks)

  return {
    bankId: normalizeNullableText(userProfile.bank_id),
    bankName: normalizeNullableText(bank?.short_name),
    bankAccountNumber: normalizeNullableText(userProfile.bank_account_number),
    bankAccountHolderName: normalizeNullableText(userProfile.bank_account_holder_name),
  }
}

export function buildPersonalBankUpdateData(input: PersonalBankUpdateInput) {
  const updateData: Record<string, string | null> = {}

  if (input.bankId !== undefined) {
    updateData.bank_id = normalizeNullableText(input.bankId)
  }

  if (input.bankAccountNumber !== undefined) {
    updateData.bank_account_number = normalizeNullableText(input.bankAccountNumber)
  }

  if (input.bankAccountHolderName !== undefined) {
    updateData.bank_account_holder_name = normalizeNullableText(input.bankAccountHolderName)
  }

  return updateData
}

export function validateMsiaBankAccount(bank: MsiaBankRule | null | undefined, accountNumber: NullableText): boolean {
  const normalizedAccountNumber = normalizeNullableText(accountNumber)

  if (!bank?.id || !normalizedAccountNumber) {
    return false
  }

  if (bank.is_active === false) {
    return false
  }

  const minLength = bank.min_account_length ?? 0
  const maxLength = bank.max_account_length ?? Number.MAX_SAFE_INTEGER

  if (normalizedAccountNumber.length < minLength || normalizedAccountNumber.length > maxLength) {
    return false
  }

  if (bank.is_numeric_only && !/^[0-9]+$/.test(normalizedAccountNumber)) {
    return false
  }

  return true
}

export function validatePersonalCashbackBank(input: CashbackBankValidationInput) {
  const normalizedBankId = normalizeNullableText(input.bankId)

  if (!normalizedBankId || input.bank?.id !== normalizedBankId) {
    return {
      isValid: false,
      error: PERSONAL_CASHBACK_BANK_ERROR,
    }
  }

  if (!validateMsiaBankAccount(input.bank, input.bankAccountNumber)) {
    return {
      isValid: false,
      error: PERSONAL_CASHBACK_BANK_ERROR,
    }
  }

  return {
    isValid: true,
    error: null,
  }
}
