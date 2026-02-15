'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  CreditCard,
  Check,
  X,
  Loader2,
  Eye,
  EyeOff,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

// ── Provider definitions ──────────────────────────────────────────

interface ProviderDef {
  key: string
  name: string
  description: string
  docsUrl: string
  logo: string // emoji / abbreviation
  fields: FieldDef[]
}

interface FieldDef {
  key: string
  label: string
  type: 'text' | 'password' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[]
  required?: boolean
}

const PROVIDERS: ProviderDef[] = [
  {
    key: 'toyyibpay',
    name: 'ToyyibPay',
    description:
      'Malaysian payment gateway supporting FPX online banking and credit/debit cards. Popular for local businesses.',
    docsUrl: 'https://toyyibpay.com/apireference',
    logo: '🇲🇾',
    fields: [
      { key: 'secret_key', label: 'User Secret Key', type: 'password', placeholder: 'xxxxxxxx-xxxx-xxxx…', required: true },
      { key: 'category_code', label: 'Category Code', type: 'text', placeholder: 'e.g. a1b2c3d4', required: true },
      {
        key: 'environment',
        label: 'Environment',
        type: 'select',
        options: [
          { value: 'sandbox', label: 'Sandbox (Testing)' },
          { value: 'production', label: 'Production (Live)' },
        ],
        required: true,
      },
    ],
  },
  {
    key: 'billplz',
    name: 'Billplz',
    description:
      'Simplified Malaysian payment platform with FPX. Clean API with fast settlement.',
    docsUrl: 'https://www.billplz.com/api',
    logo: '💳',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'xxxxxxxx-xxxx…', required: true },
      { key: 'collection_id', label: 'Collection ID', type: 'text', placeholder: 'e.g. abc123', required: true },
      { key: 'x_signature_key', label: 'X-Signature Key', type: 'password', placeholder: 'For webhook verification' },
      {
        key: 'environment',
        label: 'Environment',
        type: 'select',
        options: [
          { value: 'sandbox', label: 'Sandbox (Testing)' },
          { value: 'production', label: 'Production (Live)' },
        ],
        required: true,
      },
    ],
  },
  {
    key: 'stripe',
    name: 'Stripe',
    description:
      'Global payment platform supporting cards, wallets, and 135+ currencies. Best for international sales.',
    docsUrl: 'https://stripe.com/docs',
    logo: '🌐',
    fields: [
      { key: 'publishable_key', label: 'Publishable Key', type: 'text', placeholder: 'pk_test_…', required: true },
      { key: 'secret_key', label: 'Secret Key', type: 'password', placeholder: 'sk_test_…', required: true },
      { key: 'webhook_secret', label: 'Webhook Signing Secret', type: 'password', placeholder: 'whsec_…' },
    ],
  },
]

// ── Component ─────────────────────────────────────────────────────

interface Props {
  organizationId: string
  canEdit: boolean
}

interface GatewayRow {
  id?: string
  provider: string
  is_active: boolean
  credentials: Record<string, string>
}

export default function PaymentGatewaySettingsView({ organizationId, canEdit }: Props) {
  // Cast to any: new tables not in generated types until migration runs
  const supabase: any = createClient()
  const [gateways, setGateways] = useState<Map<string, GatewayRow>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [revealPassword, setRevealPassword] = useState<Record<string, boolean>>({})
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // ── Load existing gateway settings ─────────────────────────────

  const loadGateways = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('payment_gateway_settings')
      .select('*')
      .eq('organization_id', organizationId)

    if (!error && data) {
      const map = new Map<string, GatewayRow>()
      data.forEach((row: any) => {
        map.set(row.provider, {
          id: row.id,
          provider: row.provider,
          is_active: row.is_active,
          credentials: row.credentials || {},
        })
      })
      setGateways(map)
    }
    setLoading(false)
  }, [organizationId, supabase])

  useEffect(() => {
    loadGateways()
  }, [loadGateways])

  // ── Save / Update ──────────────────────────────────────────────

  const handleSave = async (providerKey: string, credentials: Record<string, string>, activate: boolean) => {
    setSaving(providerKey)
    setMessage(null)

    const existing = gateways.get(providerKey)

    try {
      if (activate) {
        // Deactivate all other providers first
        const { error: deactErr } = await supabase
          .from('payment_gateway_settings')
          .update({ is_active: false })
          .eq('organization_id', organizationId)
          .neq('provider', providerKey)

        if (deactErr) console.error('Deactivation error:', deactErr)
      }

      if (existing?.id) {
        // Update
        const { error } = await supabase
          .from('payment_gateway_settings')
          .update({
            credentials,
            is_active: activate,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        // Insert
        const { error } = await supabase.from('payment_gateway_settings').insert({
          organization_id: organizationId,
          provider: providerKey,
          credentials,
          is_active: activate,
        })
        if (error) throw error
      }

      setMessage({ type: 'success', text: `${providerKey} settings saved${activate ? ' & activated' : ''}.` })
      await loadGateways()
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save' })
    } finally {
      setSaving(null)
    }
  }

  const handleDeactivate = async (providerKey: string) => {
    const existing = gateways.get(providerKey)
    if (!existing?.id) return
    setSaving(providerKey)
    try {
      await supabase
        .from('payment_gateway_settings')
        .update({ is_active: false })
        .eq('id', existing.id)
      setMessage({ type: 'success', text: `${providerKey} deactivated.` })
      await loadGateways()
    } catch {
      setMessage({ type: 'error', text: 'Failed to deactivate' })
    } finally {
      setSaving(null)
    }
  }

  // ── Toggle password visibility ─────────────────────────────────

  const toggleReveal = (fieldId: string) => {
    setRevealPassword((prev) => ({ ...prev, [fieldId]: !prev[fieldId] }))
  }

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="h-10 w-10 rounded-xl bg-gray-900 flex items-center justify-center">
          <CreditCard className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">Payment Gateway</h2>
          <p className="text-xs text-gray-500">
            Configure a payment provider for storefront checkout. Only one can be active at a time.
          </p>
        </div>
      </div>

      {/* Status message */}
      {message && (
        <div
          className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-50 border border-green-100 text-green-700'
              : 'bg-red-50 border border-red-100 text-red-700'
          }`}
        >
          {message.type === 'success' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Provider cards */}
      {PROVIDERS.map((provider) => {
        const saved = gateways.get(provider.key)
        const isActive = saved?.is_active ?? false
        const isExpanded = expandedProvider === provider.key

        return (
          <ProviderCard
            key={provider.key}
            provider={provider}
            saved={saved}
            isActive={isActive}
            isExpanded={isExpanded}
            canEdit={canEdit}
            saving={saving === provider.key}
            revealPassword={revealPassword}
            onToggleExpand={() => setExpandedProvider(isExpanded ? null : provider.key)}
            onToggleReveal={toggleReveal}
            onSave={handleSave}
            onDeactivate={handleDeactivate}
          />
        )
      })}

      {/* Manual / no gateway info */}
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-4 text-center">
        <p className="text-xs text-gray-400">
          If no gateway is activated, orders will default to <strong>manual payment</strong> mode.
          <br />
          You can enable a gateway at any time.
        </p>
      </div>
    </div>
  )
}

// ── ProviderCard sub-component ────────────────────────────────────

function ProviderCard({
  provider,
  saved,
  isActive,
  isExpanded,
  canEdit,
  saving,
  revealPassword,
  onToggleExpand,
  onToggleReveal,
  onSave,
  onDeactivate,
}: {
  provider: ProviderDef
  saved?: GatewayRow
  isActive: boolean
  isExpanded: boolean
  canEdit: boolean
  saving: boolean
  revealPassword: Record<string, boolean>
  onToggleExpand: () => void
  onToggleReveal: (fieldId: string) => void
  onSave: (providerKey: string, credentials: Record<string, string>, activate: boolean) => Promise<void>
  onDeactivate: (providerKey: string) => Promise<void>
}) {
  const [localCreds, setLocalCreds] = useState<Record<string, string>>(saved?.credentials || {})

  // Sync when saved data changes
  useEffect(() => {
    if (saved?.credentials) setLocalCreds(saved.credentials)
  }, [saved])

  const updateField = (key: string, value: string) => {
    setLocalCreds((prev) => ({ ...prev, [key]: value }))
  }

  const requiredFilled = provider.fields
    .filter((f) => f.required)
    .every((f) => localCreds[f.key]?.trim())

  return (
    <div
      className={`rounded-xl border transition-all ${
        isActive
          ? 'border-green-200 bg-green-50/30 shadow-sm'
          : 'border-gray-100 bg-white shadow-sm'
      }`}
    >
      {/* Header */}
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center gap-3 p-4 text-left"
      >
        <span className="text-2xl">{provider.logo}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">{provider.name}</span>
            {isActive && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold uppercase tracking-wide">
                <ShieldCheck className="h-3 w-3" /> Active
              </span>
            )}
            {saved && !isActive && (
              <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold uppercase tracking-wide">
                Configured
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{provider.description}</p>
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-4">
          {/* Docs link */}
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            API Documentation
          </a>

          {/* Credential fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {provider.fields.map((field) => {
              const fieldId = `${provider.key}_${field.key}`
              const isPassword = field.type === 'password'
              const revealed = revealPassword[fieldId]

              return (
                <div key={field.key} className={field.type === 'select' ? '' : 'sm:col-span-2'}>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">
                    {field.label}
                    {field.required && <span className="text-red-400"> *</span>}
                  </label>
                  {field.type === 'select' ? (
                    <select
                      value={localCreds[field.key] || ''}
                      onChange={(e) => updateField(field.key, e.target.value)}
                      disabled={!canEdit}
                      className="w-full h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900/10 disabled:opacity-50"
                    >
                      <option value="">Select…</option>
                      {field.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="relative">
                      <input
                        type={isPassword && !revealed ? 'password' : 'text'}
                        value={localCreds[field.key] || ''}
                        onChange={(e) => updateField(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        disabled={!canEdit}
                        className="w-full h-9 rounded-lg border border-gray-200 bg-white pl-3 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900/10 disabled:opacity-50"
                      />
                      {isPassword && (
                        <button
                          type="button"
                          onClick={() => onToggleReveal(fieldId)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Actions */}
          {canEdit && (
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={() => onSave(provider.key, localCreds, true)}
                disabled={saving || !requiredFilled}
                className="h-9 px-4 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                Save & Activate
              </button>
              <button
                onClick={() => onSave(provider.key, localCreds, false)}
                disabled={saving || !requiredFilled}
                className="h-9 px-4 rounded-lg border border-gray-200 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                Save Only
              </button>
              {isActive && (
                <button
                  onClick={() => onDeactivate(provider.key)}
                  disabled={saving}
                  className="h-9 px-4 rounded-lg border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 transition disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <X className="h-3.5 w-3.5" />
                  Deactivate
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
