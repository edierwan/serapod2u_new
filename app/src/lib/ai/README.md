# HR AI Assistant

## Overview

The HR AI Assistant provides an integrated chat experience on the HR module landing page (`/hr`). It helps HR Admins and Super Admins verify that the HR module is correctly configured before use.

### Key Features
- **Configuration Audit** — Automated readiness check across 8 sections (Company Defaults, Org Structure, Attendance, Leave, Payroll, Security, Benefits, Onboarding)
- **AI Chat** — Natural language Q&A about HR configuration status
- **Fix Actions** — One-click fixes for common missing configurations (leave types, approval flows, positions, attendance policies, shifts)
- **Offline Mode** — When AI providers are unavailable, the audit still works and provides smart answers from direct DB queries
- **Multi-Provider** — Switch between Ollama and Moltbot backends per tenant or per request

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  HR Page UI  (HrAiAssistant.tsx)                            │
│  ├── Floating button (bottom-right)                         │
│  ├── TopNav "AI Assistant" icon                             │
│  └── Right-side Sheet/Drawer with chat                      │
├─────────────────────────────────────────────────────────────┤
│  API Routes                                                  │
│  ├── GET  /api/hr/ai/audit        → HR readiness audit      │
│  ├── POST /api/hr/ai/chat         → AI chat (with context)  │
│  └── POST /api/hr/ai/actions/:key → Fix actions              │
├─────────────────────────────────────────────────────────────┤
│  AI Gateway  (lib/ai/aiGateway.ts)                          │
│  ├── Provider selection + normalization                      │
│  ├── Rate limiting (30 req/min per user)                    │
│  └── Audit logging (redacted)                                │
├─────────────────────────────────────────────────────────────┤
│  Providers                                                   │
│  ├── lib/ai/providers/ollama.ts    → HTTP client (Ollama)    │
│  └── lib/ai/providers/moltbot.ts   → HTTP client (adapter)  │
└─────────────────────────────────────────────────────────────┘
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | Yes | Base URL for Ollama API (e.g., `https://bot.serapod2u.com/ollama`) |
| `OLLAMA_TOKEN` | No | Proxy auth token (x-ollama-key header) |
| `OLLAMA_MODEL` | No | Ollama model name (default: `qwen2.5:3b`) |
| `MOLTBOT_ADAPTER_URL` | Yes (if using Moltbot) | Base URL for Moltbot adapter service |
| `MOLTBOT_ADAPTER_TOKEN` | No | Bearer token for Moltbot adapter |
| `AI_DEFAULT_PROVIDER` | No | Default provider: `ollama` or `moltbot`. Falls back to first available. |

See `.env.ai.example` for a template.

**Security:** Tokens are NEVER hardcoded. All secrets live in `.env.local` (gitignored).

---

## Provider Switching

Per-tenant or per-request switching:

```typescript
// In chat request body
POST /api/hr/ai/chat
{ "message": "...", "provider": "moltbot" }

// Or set globally via env
AI_DEFAULT_PROVIDER=moltbot
```

The AI Gateway auto-selects the first available provider if none is specified.

---

## API Endpoints

### `GET /api/hr/ai/audit`

Returns a comprehensive HR configuration audit.

**Auth:** Requires Super Admin (role_level ≤ 20) or HR Manager role.

**Response:**
```json
{
  "success": true,
  "data": {
    "orgId": "uuid",
    "generatedAt": "2026-02-11T...",
    "summary": { "total": 25, "configured": 18, "partial": 4, "missing": 3 },
    "sections": [
      {
        "key": "company_defaults", "label": "Company Defaults", "status": "partial",
        "checks": [
          { "key": "timezone", "label": "Timezone configured", "status": "configured", "detail": "Timezone: Asia/Kuala_Lumpur" },
          { "key": "payroll_currency", "label": "Payroll currency", "status": "missing", "detail": "No payroll currency configured", "fix_key": "set_payroll_currency" }
        ]
      }
    ]
  }
}
```

### `POST /api/hr/ai/chat`

Send a chat message. The server auto-fetches audit data as context.

**Body:**
```json
{
  "message": "Is HR configuration ready?",
  "provider": "ollama",
  "history": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "provider": "ollama",
    "message": "Your HR configuration is 72% complete...",
    "suggested_actions": [{ "key": "define_leave_types", "label": "Create default leave types", "confirm_required": true }]
  }
}
```

### `POST /api/hr/ai/actions/:actionKey`

Execute a fix action. Requires explicit confirmation.

**Supported actions:**
- `define_leave_types` — Create standard leave types (AL, MC, HL, etc.)
- `define_leave_approval_flow` — Create default approval chain
- `create_default_positions` — Create common job positions
- `create_attendance_policy` — Create default attendance policy
- `create_default_shifts` — Create standard office hours shift
- `request_employee_bank_details` — Identify employees missing bank info

**Body:**
```json
{ "confirmation": true }
```

---

## Security

1. **No arbitrary SQL** — All audit and fix actions use Supabase client with RLS
2. **RBAC enforced** — Every endpoint checks role (Super Admin / HR Manager)
3. **Tenant isolation** — All queries scoped to caller's `organization_id`
4. **No PII in AI context** — Only counts and status flags sent to AI provider
5. **Rate limiting** — 30 requests/minute per user
6. **Audit logging** — All AI requests logged (message truncated, no secrets)
7. **AI never talks to Supabase** — Serapod is the only data plane

---

## File Structure

```
app/src/
├── lib/ai/
│   ├── types.ts              # Shared types
│   ├── config.ts             # Provider configuration
│   ├── aiGateway.ts          # Unified AI interface
│   ├── hrAudit.ts            # HR readiness audit logic
│   └── providers/
│       ├── ollama.ts         # Ollama HTTP client
│       └── moltbot.ts        # Moltbot HTTP client
├── app/api/hr/ai/
│   ├── audit/route.ts        # GET /api/hr/ai/audit
│   ├── chat/route.ts         # POST /api/hr/ai/chat
│   └── actions/[actionKey]/route.ts  # POST /api/hr/ai/actions/:key
└── modules/hr/components/
    └── HrAiAssistant.tsx     # UI: floating button + chat drawer
```
