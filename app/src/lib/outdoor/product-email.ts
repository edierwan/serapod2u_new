import { getStorageUrl } from '@/lib/utils'
import { OUTDOOR_NAV, outdoorColorFromText } from '@/lib/outdoor/merch'

const BARK = '#3f1c1f'
const CREAM = '#f1e6b2'
const MOSS = '#3f1c1f'
const INK = '#2e1416'
const MUTED = '#6d5a52'

export type OutdoorEmailKind = 'new' | 'update' | 'removed'

export type OutdoorEmailColor = { name: string; price?: number }

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]!))
}

function money(amount: number) {
  return `RM ${amount.toFixed(2)}`
}

function colorPresentation(name: string) {
  const found = outdoorColorFromText(name)
  if (!found) return null
  const rawLabel = String(found.label || '')
  const label = rawLabel.startsWith('#') ? 'Custom color' : rawLabel
  return { hex: found.hex, label }
}

function absoluteImage(url: string, origin: string) {
  const trimmed = String(url || '').trim()
  if (!trimmed || trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return ''
  if (trimmed.startsWith('/')) return `${origin}${trimmed}`
  return getStorageUrl(trimmed) || trimmed
}

export function outdoorPublicOrigin() {
  const env = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  if (env && !/0\.0\.0\.0|127\.0\.0\.1/i.test(env)) return env
  return 'https://stg.serapod2u.com'
}

export function buildOutdoorProductEmail(input: {
  kind: OutdoorEmailKind
  name: string
  price?: number
  description?: string
  imageUrl?: string
  productId?: string
  nav?: string
  colors?: OutdoorEmailColor[]
}) {
  const origin = outdoorPublicOrigin()
  const name = String(input.name || 'Product').trim()
  const description = String(input.description || '').trim()
  const price = Number(input.price)
  const hasPrice = Number.isFinite(price) && price > 0
  const image = absoluteImage(String(input.imageUrl || ''), origin)
  const productUrl = input.productId ? `${origin}/outdoor/shop/${input.productId}` : `${origin}/outdoor`
  const collection = OUTDOOR_NAV.find((item) => item.key === input.nav)?.label || ''
  const colors = (input.colors || [])
    .map((item) => {
      const look = colorPresentation(item.name)
      if (!look) return null
      const amount = Number(item.price)
      return { ...look, price: Number.isFinite(amount) && amount > 0 ? amount : null }
    })
    .filter((item): item is { hex: string; label: string; price: number | null } => Boolean(item))

  const kicker = input.kind === 'new' ? 'New product' : input.kind === 'update' ? 'Product update' : 'No longer available'
  const subject = input.kind === 'update'
    ? `SeraOutdoor update: ${name}`
    : input.kind === 'removed'
      ? `SeraOutdoor: ${name} is no longer available`
      : `SeraOutdoor: ${name}`
  const lead = input.kind === 'removed'
    ? `${name} has been removed from the SeraOutdoor shop.`
    : input.kind === 'update'
      ? `${name} has been updated on the SeraOutdoor shop.`
      : `${name} is now on the SeraOutdoor shop.`

  const text = [
    lead,
    hasPrice ? money(price) : '',
    collection ? `Category: ${collection}` : '',
    colors.map((item) => item.price ? `${item.label} · ${money(item.price)}` : item.label).join(', '),
    description,
    productUrl,
    '{{unsubscribe_url}}',
  ].filter(Boolean).join('\n')

  const colorRows = colors.map((item) => `
    <tr>
      <td style="padding:6px 0;">
        <table cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td width="18" height="18" style="width:18px;height:18px;background:${item.hex};border-radius:9px;font-size:0;line-height:0;">&nbsp;</td>
            <td style="padding-left:10px;font-family:Georgia, 'Times New Roman', serif;font-size:15px;color:${INK};">${escapeHtml(item.label)}${item.price ? ` · ${money(item.price)}` : ''}</td>
          </tr>
        </table>
      </td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:${CREAM};">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${CREAM};">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;">
          <tr>
            <td style="background:${BARK};padding:22px 28px;">
              <p style="margin:0;font-family:Georgia, 'Times New Roman', serif;font-size:22px;letter-spacing:0.04em;color:${CREAM};">SeraOutdoor</p>
            </td>
          </tr>
          ${image ? `<tr><td style="padding:0;background:#ffffff;"><img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>` : ''}
          <tr>
            <td style="padding:28px 28px 8px;">
              <p style="margin:0;font-family:Arial, Helvetica, sans-serif;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${MOSS};">${escapeHtml(kicker)}</p>
              <h1 style="margin:10px 0 0;font-family:Georgia, 'Times New Roman', serif;font-size:32px;line-height:1.15;font-weight:500;color:${INK};">${escapeHtml(name)}</h1>
              ${hasPrice ? `<p style="margin:14px 0 0;font-family:Arial, Helvetica, sans-serif;font-size:20px;font-weight:700;color:${BARK};">${money(price)}</p>` : ''}
              ${collection ? `<p style="margin:8px 0 0;font-family:Arial, Helvetica, sans-serif;font-size:14px;color:${MUTED};">${escapeHtml(collection)}</p>` : ''}
            </td>
          </tr>
          ${colorRows ? `<tr><td style="padding:8px 28px 0;"><table width="100%" cellpadding="0" cellspacing="0" role="presentation">${colorRows}</table></td></tr>` : ''}
          ${description ? `<tr><td style="padding:16px 28px 0;font-family:Arial, Helvetica, sans-serif;font-size:15px;line-height:1.6;color:${INK};">${escapeHtml(description).replace(/\n/g, '<br>')}</td></tr>` : ''}
          <tr>
            <td style="padding:24px 28px 32px;">
              <a href="${escapeHtml(productUrl)}" style="display:inline-block;background:${MOSS};color:#ffffff;font-family:Arial, Helvetica, sans-serif;font-size:15px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:999px;">View on the shop</a>
            </td>
          </tr>
          <tr>
            <td style="background:${CREAM};padding:18px 28px;">
              <p style="margin:0;font-family:Arial, Helvetica, sans-serif;font-size:12px;line-height:1.5;color:${MUTED};">SeraOutdoor · outdoor@serapod.com<br>You are receiving this because you subscribed to Outdoor updates.{{unsubscribe_url}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, text, html }
}

export function buildOutdoorWelcomeEmail() {
  const origin = outdoorPublicOrigin()
  const shopUrl = `${origin}/outdoor`
  const logoUrl = `${origin}/outdoor/brand/logo.png`
  const welcomeImage = `${origin}/outdoor/brand/banners/moonchair.jpg`
  const subject = 'You are subscribed to SeraOutdoor'
  const text = [
    'Welcome to SeraOutdoor.',
    'We will email you when a product is added or updated.',
    shopUrl,
    '{{unsubscribe_url}}',
  ].join('\n')
  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:${CREAM};">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${CREAM};">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;">
          <tr>
            <td align="center" style="background:${BARK};padding:22px 28px;">
              <img src="${escapeHtml(logoUrl)}" alt="SeraOutdoor" width="210" style="display:block;width:210px;max-width:70%;height:auto;border:0;">
            </td>
          </tr>
          <tr>
            <td style="padding:0;background:#ffffff;">
              <a href="${escapeHtml(shopUrl)}" style="text-decoration:none;">
                <img src="${escapeHtml(welcomeImage)}" alt="Welcome to SeraOutdoor" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;">
              <h1 style="margin:0;font-family:Georgia, 'Times New Roman', serif;font-size:32px;line-height:1.15;font-weight:500;color:${INK};">Welcome</h1>
              <p style="margin:14px 0 0;font-family:Arial, Helvetica, sans-serif;font-size:15px;line-height:1.6;color:${INK};">You are subscribed. We will email you when a product is added or updated.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 28px 32px;">
              <a href="${escapeHtml(shopUrl)}" style="display:inline-block;background:${MOSS};color:#ffffff;font-family:Arial, Helvetica, sans-serif;font-size:15px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:999px;">Visit the shop</a>
            </td>
          </tr>
          <tr>
            <td style="background:${CREAM};padding:18px 28px;">
              <p style="margin:0;font-family:Arial, Helvetica, sans-serif;font-size:12px;line-height:1.5;color:${MUTED};">SeraOutdoor · outdoor@serapod.com<br>You can leave this list at any time.{{unsubscribe_url}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  return { subject, text, html }
}
