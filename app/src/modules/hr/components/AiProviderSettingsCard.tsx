'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Bot, Loader2, CheckCircle2, XCircle, Save, Eye, EyeOff,
  Wifi, WifiOff, RefreshCw, Trash2, Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/use-toast'

// ── Types ────────────────────────────────────────────────────────

interface AiProviderSettingsCardProps {
  organizationId: string
  canEdit: boolean
}

interface ProviderSettings {
  provider: string
  baseUrl: string | null
  tokenHint: string | null
  chatPath: string | null
  model: string | null
  enabled: boolean
  updatedAt: string | null
  source: 'db' | 'env' | 'none'
}

interface HealthStatus {
  ok: boolean
  providers: {
    openclaw: {
      configured: boolean
      ok: boolean
      authenticated: boolean
      hint: string
      source?: string
    }
    ollama?: {
      configured: boolean
      ok: boolean
      hint: string
      model?: string | null
      models?: string[]
      source?: string
    }
  }
  defaultProvider: string
}

// ── Component ────────────────────────────────────────────────────

export default function AiProviderSettingsCard({
  organizationId,
  canEdit,
}: AiProviderSettingsCardProps) {
  // Form state
  const [provider, setProvider] = useState('openclaw')
  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [chatPath, setChatPath] = useState('')
  const [model, setModel] = useState('qwen2.5:3b')
  const [enabled, setEnabled] = useState(true)
  const [tokenHint, setTokenHint] = useState<string | null>(null)
  const [source, setSource] = useState<'db' | 'env' | 'none'>('none')

  // UI state
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [health, setHealth] = useState<HealthStatus | null>(null)

  // ── Load settings ──────────────────────────────────────────────

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/settings/ai-provider')
      if (!res.ok) {
        if (res.status === 403) {
          toast({ title: 'Access Denied', description: 'You do not have permission to view AI settings.', variant: 'destructive' })
          return
        }
        throw new Error('Failed to load AI settings')
      }
      const data: ProviderSettings = await res.json()
      setProvider(data.provider ?? 'openclaw')
      setBaseUrl(data.baseUrl ?? '')
      setChatPath(data.chatPath ?? '')
      setModel(data.model ?? 'qwen2.5:3b')
      setEnabled(data.enabled ?? false)
      setTokenHint(data.tokenHint)
      setSource(data.source)
      // Don't set token — leave it empty (only hint shown)
      setToken('')
    } catch (err: any) {
      console.error('Failed to load AI settings:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadSettings() }, [loadSettings])

  // ── Test connection ────────────────────────────────────────────

  const testConnection = useCallback(async () => {
    try {
      setTesting(true)

      // POST current form values so the test uses what the user sees, not DB config
      const res = await fetch('/api/settings/ai-provider/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          baseUrl: baseUrl || (provider === 'ollama' ? 'http://127.0.0.1:11434' : ''),
          model: provider === 'ollama' ? model : undefined,
          token: token || undefined,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Test request failed')
      }

      const data = await res.json()

      // Update health state for display
      if (provider === 'ollama') {
        setHealth({
          ok: data.ok,
          defaultProvider: 'ollama',
          providers: {
            openclaw: { configured: false, ok: false, authenticated: false, hint: '' },
            ollama: {
              configured: true,
              ok: data.ok,
              hint: data.hint ?? '',
              model: data.model,
              models: data.models ?? [],
              source: 'test',
            },
          },
        })
      } else {
        setHealth({
          ok: data.ok,
          defaultProvider: 'openclaw',
          providers: {
            openclaw: {
              configured: true,
              ok: data.ok,
              authenticated: data.authenticated ?? false,
              hint: data.hint ?? '',
              source: 'test',
            },
          },
        })
      }

      if (data.ok) {
        toast({
          title: `${provider === 'ollama' ? 'Ollama' : 'OpenClaw'} Connection Successful`,
          description: data.hint,
        })
      } else {
        toast({
          title: `${provider === 'ollama' ? 'Ollama' : 'OpenClaw'} Connection Failed`,
          description: data.hint ?? 'Cannot reach provider.',
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      setHealth({
        ok: false,
        providers: {
          openclaw: { configured: false, ok: false, authenticated: false, hint: err.message },
        },
        defaultProvider: provider,
      })
      toast({
        title: 'Connection Error',
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setTesting(false)
    }
  }, [provider, baseUrl, model, token])

  // ── Save settings ──────────────────────────────────────────────

  const handleSave = async () => {
    if (!canEdit) return

    // Validate URL
    if (baseUrl) {
      try {
        new URL(baseUrl)
      } catch {
        toast({ title: 'Invalid URL', description: 'Please enter a valid base URL (e.g. http://example.com:50448)', variant: 'destructive' })
        return
      }
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        provider,
        baseUrl: baseUrl.trim() || null,
        chatPath: chatPath.trim() || null,
        model: provider === 'ollama' ? (model.trim() || 'qwen2.5:3b') : null,
        enabled,
      }

      // Only send token if user typed something
      if (token.trim()) {
        body.token = token.trim()
      }

      const res = await fetch('/api/settings/ai-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to save')
      }

      // Update display from response
      if (data.data) {
        setTokenHint(data.data.tokenHint)
        setSource(data.data.source)
      }

      // Clear the token field after save
      setToken('')
      setShowToken(false)

      toast({
        title: 'Settings Saved',
        description: 'AI provider settings updated successfully.',
      })
    } catch (err: any) {
      toast({
        title: 'Save Failed',
        description: err.message,
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  // ── Clear token ────────────────────────────────────────────────

  const handleClearToken = async () => {
    if (!canEdit) return
    setSaving(true)
    try {
      const res = await fetch('/api/settings/ai-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, clearToken: true, baseUrl, enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setTokenHint(null)
      setToken('')
      toast({ title: 'Token Cleared', description: 'The stored token has been removed.' })
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  const statusOk = provider === 'ollama'
    ? health?.providers?.ollama?.ok
    : health?.ok
  const providerHealth = provider === 'ollama'
    ? health?.providers?.ollama
    : health?.providers?.openclaw
  const ollamaHealth = health?.providers?.ollama

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="h-5 w-5 text-violet-600" />
              AI Assistant Settings
            </CardTitle>
            <div className="mt-1 text-sm text-muted-foreground">
              Configure the AI provider for all modules (HR, Finance, Supply Chain, Customer &amp; Growth).
              {source === 'env' && (
                <Badge variant="outline" className="ml-2 text-xs">Using .env defaults</Badge>
              )}
              {source === 'db' && (
                <Badge variant="secondary" className="ml-2 text-xs">Custom configuration</Badge>
              )}
            </div>
          </div>

          {/* Health status pill */}
          {health !== null && (
            <Badge
              variant={statusOk ? 'default' : 'destructive'}
              className={`gap-1 ${statusOk ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : ''}`}
            >
              {statusOk ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              {statusOk ? 'Online' : 'Offline'}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Provider selector */}
        <div className="space-y-2">
          <Label htmlFor="ai-provider">Provider</Label>
          <Select value={provider} onValueChange={(v) => {
            setProvider(v)
            setHealth(null)
            // Reset base URL to appropriate default when switching providers
            if (v === 'ollama') {
              setBaseUrl('http://127.0.0.1:11434')
              setModel('qwen2.5:3b')
              setToken('')
              setTokenHint(null)
            } else if (v === 'openclaw') {
              setBaseUrl('')
              setModel('')
            }
          }} disabled={!canEdit}>
            <SelectTrigger id="ai-provider" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openclaw">OpenClaw</SelectItem>
              <SelectItem value="ollama">Ollama (Local LLM)</SelectItem>
              <SelectItem value="openai" disabled>OpenAI (coming soon)</SelectItem>
              <SelectItem value="moltbot" disabled>Moltbot (coming soon)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* ── OpenClaw-specific fields ──────────────────────────── */}
        {provider === 'openclaw' && (
          <>
            {/* Base URL */}
            <div className="space-y-2">
              <Label htmlFor="ai-base-url">Base URL</Label>
              <Input
                id="ai-base-url"
                type="url"
                placeholder="http://72.62.253.182:50448"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={!canEdit}
              />
              <p className="text-xs text-muted-foreground">
                The full base URL of your OpenClaw server (no trailing slash).
              </p>
            </div>

            {/* Token */}
            <div className="space-y-2">
              <Label htmlFor="ai-token">Gateway Token</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="ai-token"
                    type={showToken ? 'text' : 'password'}
                    placeholder={tokenHint ? `Current: ${tokenHint}` : 'Paste your OpenClaw gateway token'}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    disabled={!canEdit}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {tokenHint && canEdit && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleClearToken}
                    disabled={saving}
                    title="Clear stored token"
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                )}
              </div>
              <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>Token is stored encrypted server-side. It is never sent back to the browser after saving.</span>
              </div>
            </div>

            {/* Chat path (advanced) */}
            <div className="space-y-2">
              <Label htmlFor="ai-chat-path">Chat Endpoint Path <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="ai-chat-path"
                placeholder="/api/chat (default)"
                value={chatPath}
                onChange={(e) => setChatPath(e.target.value)}
                disabled={!canEdit}
              />
            </div>
          </>
        )}

        {/* ── Ollama-specific fields ──────────────────────────── */}
        {provider === 'ollama' && (
          <>
            {/* Base URL */}
            <div className="space-y-2">
              <Label htmlFor="ai-base-url">Base URL</Label>
              <Input
                id="ai-base-url"
                type="url"
                placeholder="http://127.0.0.1:11434"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={!canEdit}
              />
              <p className="text-xs text-muted-foreground">
                Ollama server address. Default: http://127.0.0.1:11434 (localhost on VPS).
              </p>
            </div>

            {/* Model */}
            <div className="space-y-2">
              <Label htmlFor="ai-model">Model</Label>
              <Select value={model} onValueChange={setModel} disabled={!canEdit}>
                <SelectTrigger id="ai-model" className="w-full">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qwen2.5:3b">qwen2.5:3b (recommended, fast)</SelectItem>
                  <SelectItem value="qwen2.5:3b-instruct">qwen2.5:3b-instruct</SelectItem>
                  <SelectItem value="llama3.2:3b">llama3.2:3b (alternative)</SelectItem>
                  <SelectItem value="qwen2.5:7b-instruct-q4_K_M">qwen2.5:7b-instruct-q4 (slower, better quality)</SelectItem>
                  <SelectItem value="phi3:mini">phi3:mini (compact)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choose a model suitable for your server resources. For 8GB RAM / 2 vCPU, use 3B parameter models.
              </p>
            </div>

            {/* Available models info */}
            {ollamaHealth?.models && ollamaHealth.models.length > 0 && (
              <div className="rounded-lg border p-3 bg-muted/30">
                <p className="text-xs font-medium mb-1">Available models on server:</p>
                <div className="flex flex-wrap gap-1">
                  {ollamaHealth.models.map((m: string) => (
                    <Badge key={m} variant="outline" className="text-xs">{m}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* No token needed info */}
            <div className="flex items-start gap-1.5 text-xs text-muted-foreground rounded-lg border p-3 bg-blue-50 dark:bg-blue-900/10">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-600" />
              <span>Ollama runs locally on your VPS — no API key or token required. Requests are made server-to-server (backend → localhost).</span>
            </div>
          </>
        )}

        {/* Enabled toggle */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="ai-enabled">Enable AI Assistant</Label>
            <p className="text-xs text-muted-foreground">
              When disabled, all AI assistants will work in offline-only mode.
            </p>
          </div>
          <Switch
            id="ai-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!canEdit}
          />
        </div>

        {/* Health detail (expanded after test) */}
        {providerHealth && (
          <div className={`rounded-lg border p-3 text-sm ${providerHealth.ok
              ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800'
              : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
            }`}>
            <div className="flex items-center gap-2 font-medium mb-1">
              {providerHealth.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
              <span>{providerHealth.hint}</span>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              {provider === 'openclaw' && 'authenticated' in providerHealth && (
                <p>Authenticated: {(providerHealth as any).authenticated ? 'Yes' : 'No'}</p>
              )}
              {provider === 'ollama' && ollamaHealth?.models && ollamaHealth.models.length > 0 && (
                <p>Models: {ollamaHealth.models.join(', ')}</p>
              )}
              {'source' in providerHealth && (providerHealth as any).source && (
                <p>Settings source: {(providerHealth as any).source}</p>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          {canEdit && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="gap-1.5"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving…' : 'Save Settings'}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={testConnection}
            disabled={testing}
            className="gap-1.5"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {testing ? 'Testing…' : 'Test Connection'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
