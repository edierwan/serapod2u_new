const E164_REGEX = /^\+[1-9]\d{7,14}$/;

function stripToDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildErrorResult(input, reason) {
  return {
    input,
    digits: '',
    e164: null,
    provider: null,
    valid: false,
    reason,
  };
}

function parsePhone(input, options = {}) {
  const raw = String(input || '').trim();
  const defaultCountryCode = String(options.defaultCountryCode || '60');

  if (!raw) {
    return buildErrorResult(input, 'empty');
  }

  let digits = stripToDigits(raw);
  if (!digits) {
    return buildErrorResult(input, 'no_digits');
  }

  const hadInternationalPrefix = raw.startsWith('+') || raw.startsWith('00');
  if (raw.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (!digits) {
    return buildErrorResult(input, 'no_digits');
  }

  if (!hadInternationalPrefix) {
    if (digits.startsWith('0')) {
      digits = `${defaultCountryCode}${digits.slice(1)}`;
    } else if (defaultCountryCode === '60' && /^1\d{7,9}$/.test(digits)) {
      digits = `${defaultCountryCode}${digits}`;
    } else if (!digits.startsWith(defaultCountryCode)) {
      digits = `${defaultCountryCode}${digits}`;
    }
  }

  const e164 = `+${digits}`;
  if (!E164_REGEX.test(e164)) {
    return buildErrorResult(input, 'invalid_e164');
  }

  return {
    input,
    digits,
    e164,
    provider: digits,
    valid: true,
    reason: null,
  };
}

function normalizePhoneToE164(input, options = {}) {
  const parsed = parsePhone(input, options);
  if (!parsed.valid) {
    if (options.throwOnInvalid) {
      throw new Error(`Invalid phone number: ${parsed.reason}`);
    }
    return null;
  }
  return parsed.e164;
}

function isValidE164Phone(input) {
  return E164_REGEX.test(String(input || '').trim());
}

function toProviderPhone(input, options = {}) {
  const parsed = parsePhone(input, options);
  if (!parsed.valid) {
    if (options.throwOnInvalid) {
      throw new Error(`Invalid phone number: ${parsed.reason}`);
    }
    return null;
  }
  return parsed.provider;
}

function samePhone(left, right, options = {}) {
  const a = normalizePhoneToE164(left, options);
  const b = normalizePhoneToE164(right, options);
  return Boolean(a && b && a === b);
}

function formatPhoneDisplay(input, options = {}) {
  const normalized = normalizePhoneToE164(input, options);
  if (!normalized) return '';

  if (normalized.startsWith('+60')) {
    const number = normalized.slice(3);
    if (number.length === 9) {
      return `+60 ${number.slice(0, 2)}-${number.slice(2, 5)} ${number.slice(5)}`;
    }
    if (number.length === 10) {
      return `+60 ${number.slice(0, 2)}-${number.slice(2, 6)} ${number.slice(6)}`;
    }
  }

  return normalized;
}

function jidToPhone(jid, options = {}) {
  if (!jid) return null;
  const phone = String(jid).split('@')[0].split(':')[0];
  return normalizePhoneToE164(phone, options);
}

function phoneToJid(input, options = {}) {
  const provider = toProviderPhone(input, options);
  if (!provider) return '';
  return `${provider}@s.whatsapp.net`;
}

function maskPhone(input, options = {}) {
  const normalized = normalizePhoneToE164(input, options);
  if (!normalized) return '';
  if (normalized.length < 8) return normalized;
  const visible = 4;
  return `${normalized.slice(0, normalized.length - visible - 3)}***${normalized.slice(-visible)}`;
}

module.exports = {
  E164_REGEX,
  formatPhoneDisplay,
  isValidE164Phone,
  jidToPhone,
  maskPhone,
  normalizePhoneToE164,
  parsePhone,
  phoneToJid,
  samePhone,
  stripToDigits,
  toProviderPhone,
};