# Moltbot - AI WhatsApp Bot Service

Moltbot is an AI-powered WhatsApp bot that integrates with Baileys Gateway and Serapod Support Inbox. It supports **Full Duplex** mode where both the bot and admin can reply to users.

## Features

- 🤖 **AI Auto-Reply** - Automatic responses using OpenAI or Gemini
- 👨‍💼 **Admin Takeover** - Admin can take over conversations manually
- 📝 **AI Draft** - Generate AI drafts for admin review before sending
- 🔄 **Mode Switching** - Toggle between AUTO and TAKEOVER modes
- 📊 **Tool Calling** - Read-only tools for user lookup, points, orders
- 💬 **Command System** - `/ai reply`, `/ai draft`, `/ai auto on/off`

## Architecture

```
User WhatsApp ──→ Baileys Gateway ──→ Moltbot ──→ Supabase DB
                       ↓                              ↑
                  (INBOUND_USER)              (Support Inbox UI)
                       
Admin WhatsApp ──→ Baileys Gateway ──→ Moltbot ──→ Supabase DB
                       ↓
                  (OUTBOUND_ADMIN)
```

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run (development)
npm run dev

# Run (production)
npm start
```

## Environment Variables

```bash
# Server
PORT=4000
MOLTBOT_WEBHOOK_SECRET=your-secret
MOLTBOT_DEBUG_SECRET=your-debug-secret

# Gateway
BAILEYS_GATEWAY_URL=https://wa.serapod2u.com
SERAPOD_WA_API_KEY=your-api-key

# Admin Detection (comma-separated phone numbers)
ADMIN_WA_NUMBERS=60192277233,60123456789

# LLM Provider (openai or gemini)
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4o-mini
# Or for Gemini:
# GEMINI_API_KEY=xxx
# GEMINI_MODEL=gemini-1.5-flash

# Supabase (for direct DB writes)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx

# Safety Mode (default: true - read-only tools only)
BOT_SAFE_MODE=true

# Takeover auto-revert (ms, default: 30 min)
TAKEOVER_AUTO_REVERT_MS=1800000

# Features (all default: true)
MOLTBOT_AUTO_REPLY=true
MOLTBOT_TOOL_CALLING=true
MOLTBOT_DB_WRITES=true
```

---

## API Contracts

### 1. Health Check

**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "ok",
  "service": "moltbot",
  "time": "2026-02-01T10:00:00.000Z",
  "features": {
    "autoReply": true,
    "toolCalling": true,
    "greeting": true,
    "dbWrites": true
  }
}
```

**Curl Example:**
```bash
curl http://localhost:4000/health
```

---

### 2. Inbound Webhook (from Baileys Gateway)

**Endpoint:** `POST /webhook/whatsapp`

**Headers:**
```
Content-Type: application/json
X-Moltbot-Secret: your-secret
```

**Payload (New Format):**
```json
{
  "event": "INBOUND_USER",
  "tenantId": "default",
  "wa": {
    "phoneDigits": "60192277233",
    "remoteJid": "60192277233@s.whatsapp.net",
    "fromMe": false,
    "messageId": "ABCD1234",
    "timestamp": 1706780400000,
    "pushName": "John",
    "text": "Hello, I need help"
  }
}
```

**Event Types:**
- `INBOUND_USER` - Message from end-user (fromMe=false)
- `OUTBOUND_ADMIN` - Message from admin via WhatsApp app (fromMe=true)

**Response:**
```json
{
  "ok": true,
  "event": "INBOUND_USER",
  "messageId": "ABCD1234"
}
```

**Curl Example (Simulate User Message):**
```bash
curl -X POST http://localhost:4000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -H "X-Moltbot-Secret: your-secret" \
  -d '{
    "event": "INBOUND_USER",
    "tenantId": "default",
    "wa": {
      "phoneDigits": "60192277233",
      "remoteJid": "60192277233@s.whatsapp.net",
      "fromMe": false,
      "messageId": "test123",
      "timestamp": 1706780400000,
      "pushName": "Test User",
      "text": "Hi, how do I check my points?"
    }
  }'
```

**Curl Example (Simulate Admin Command):**
```bash
curl -X POST http://localhost:4000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -H "X-Moltbot-Secret: your-secret" \
  -d '{
    "event": "OUTBOUND_ADMIN",
    "tenantId": "default",
    "wa": {
      "phoneDigits": "60192277233",
      "remoteJid": "60192277233@s.whatsapp.net",
      "fromMe": true,
      "messageId": "admin123",
      "timestamp": 1706780500000,
      "text": "/ai reply: be more friendly"
    }
  }'
```

---

### 3. Get Conversation Mode

**Endpoint:** `GET /api/mode/:phone`

**Response:**
```json
{
  "ok": true,
  "phone": "60192277233",
  "mode": "auto",
  "hasDraft": false,
  "draftPreview": null
}
```

**Curl Example:**
```bash
curl http://localhost:4000/api/mode/60192277233
```

---

### 4. Set Conversation Mode

**Endpoint:** `POST /api/mode/:phone`

**Payload:**
```json
{
  "mode": "auto"
}
```

Valid modes: `"auto"`, `"takeover"`

**Response:**
```json
{
  "ok": true,
  "phone": "60192277233",
  "mode": "auto"
}
```

**Curl Example:**
```bash
curl -X POST http://localhost:4000/api/mode/60192277233 \
  -H "Content-Type: application/json" \
  -d '{"mode": "takeover"}'
```

---

### 5. Generate AI Draft (for Serapod UI)

**Endpoint:** `POST /api/draft/:phone`

**Payload:**
```json
{
  "instruction": "be more formal"
}
```

**Response:**
```json
{
  "ok": true,
  "phone": "60192277233",
  "draft": "Terima kasih kerana menghubungi kami. Bagaimana saya boleh membantu anda hari ini?"
}
```

**Curl Example:**
```bash
curl -X POST http://localhost:4000/api/draft/60192277233 \
  -H "Content-Type: application/json" \
  -d '{"instruction": "be friendly and helpful"}'
```

---

### 6. Send Pending Draft

**Endpoint:** `POST /api/draft/:phone/send`

**Response:**
```json
{
  "ok": true,
  "phone": "60192277233"
}
```

**Curl Example:**
```bash
curl -X POST http://localhost:4000/api/draft/60192277233/send
```

---

### 7. Send WhatsApp Message (via Gateway)

The Moltbot service sends messages through the Baileys Gateway. The Gateway API:

**Endpoint:** `POST {BAILEYS_GATEWAY_URL}/api/send`

**Headers:**
```
Content-Type: application/json
X-API-Key: your-api-key
```

**Payload:**
```json
{
  "tenantId": "default",
  "to": "60192277233",
  "message": "Hello from bot!"
}
```

**Curl Example:**
```bash
curl -X POST https://wa.serapod2u.com/api/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "tenantId": "default",
    "to": "60192277233",
    "message": "Hello from bot!"
  }'
```

---

## Admin Commands (via WhatsApp)

Admins can send these commands from the WhatsApp app (messages with `fromMe=true`):

| Command | Description |
|---------|-------------|
| `/ai reply` | Generate and send AI reply immediately |
| `/ai reply: <instruction>` | Generate reply with specific instruction |
| `/ai draft` | Generate draft (stored, not sent) |
| `/ai send` | Send pending draft |
| `/ai auto on` | Enable auto-reply mode |
| `/ai auto off` | Disable auto-reply (takeover mode) |
| `/ai summarize` | Generate conversation summary |

Alternative prefixes: `!ai`, `/bot`, `!bot`

---

## Mode State Machine

| Event | Current Mode | Result |
|-------|--------------|--------|
| User message | AUTO | Bot auto-replies |
| User message | TAKEOVER | Bot silent (admin handling) |
| Admin sends message | * | Set to TAKEOVER |
| `/ai auto on` | * | Set to AUTO |
| `/ai auto off` | * | Set to TAKEOVER |
| Admin inactive 30min | TAKEOVER | Auto-revert to AUTO |

---

## Logging

Structured log events for auditing:

- `INBOUND_USER` - Message from end-user
- `INBOUND_ADMIN` - Message from admin's personal WhatsApp
- `OUTBOUND_BOT` - Bot reply (auto or commanded)
- `OUTBOUND_ADMIN` - Admin manual reply
- `MODE_CHANGED` - Mode switched between AUTO/TAKEOVER
- `COMMAND_RECEIVED` - Admin command received
- `DRAFT_CREATED` - AI draft generated
- `DRAFT_SENT` - Draft sent

---

## Testing

### Test Auto-Reply Flow
```bash
# 1. Simulate user message
curl -X POST http://localhost:4000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -H "X-Moltbot-Secret: secret" \
  -d '{"event":"INBOUND_USER","tenantId":"default","wa":{"phoneDigits":"60192277233","fromMe":false,"messageId":"test1","timestamp":1706780400000,"text":"hi"}}'

# 2. Check mode
curl http://localhost:4000/api/mode/60192277233
```

### Test Admin Takeover
```bash
# 1. Admin sends manual reply
curl -X POST http://localhost:4000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -H "X-Moltbot-Secret: secret" \
  -d '{"event":"OUTBOUND_ADMIN","tenantId":"default","wa":{"phoneDigits":"60192277233","fromMe":true,"messageId":"admin1","timestamp":1706780500000,"text":"ok saya bantu"}}'

# 2. Check mode (should be takeover)
curl http://localhost:4000/api/mode/60192277233
```

### Test AI Draft
```bash
# 1. Admin requests draft
curl -X POST http://localhost:4000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -H "X-Moltbot-Secret: secret" \
  -d '{"event":"OUTBOUND_ADMIN","tenantId":"default","wa":{"phoneDigits":"60192277233","fromMe":true,"messageId":"cmd1","timestamp":1706780600000,"text":"/ai draft"}}'

# 2. Check draft exists
curl http://localhost:4000/api/mode/60192277233

# 3. Send draft
curl -X POST http://localhost:4000/api/draft/60192277233/send
```

### Test Auto Mode Re-enable
```bash
curl -X POST http://localhost:4000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -H "X-Moltbot-Secret: secret" \
  -d '{"event":"OUTBOUND_ADMIN","tenantId":"default","wa":{"phoneDigits":"60192277233","fromMe":true,"messageId":"cmd2","timestamp":1706780700000,"text":"/ai auto on"}}'
```

---

## Development

```bash
# Run with hot reload
npm run dev

# Type check
npx tsc --noEmit

# Build
npm run build
```
