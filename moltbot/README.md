# Moltbot - AI WhatsApp Bot for Serapod2u

AI-powered WhatsApp chatbot that handles customer inquiries about points, orders, and redemptions. Uses LLM (OpenAI or Gemini) with tool calling to fetch real data from Serapod2u.

## Features

- 🤖 AI-powered responses using GPT-4 or Gemini
- 🔧 Tool calling for real-time data (points, orders, redeems)
- 🗣️ Malay casual tone matching Serapod2u app
- 💾 Conversation memory (10 turns, 7-day TTL)
- 🔒 Secure webhook authentication
- 📊 Debug endpoints for monitoring

## Architecture

```
WhatsApp User
    ↓
baileys-gateway (VPS:3001)
    ↓ POST /webhook/whatsapp
Moltbot (VPS:4000)
    ↓ AI Processing + Tool Calls
Serapod API (Vercel)
    ↓
Moltbot
    ↓ POST /messages/send
baileys-gateway
    ↓
WhatsApp User
```

## Environment Variables

Create a `.env` file:

```bash
# Server
PORT=4000
MOLTBOT_WEBHOOK_SECRET=your-webhook-secret
MOLTBOT_DEBUG_SECRET=your-debug-secret

# Gateway (Baileys)
BAILEYS_GATEWAY_URL=https://wa.serapod2u.com
SERAPOD_WA_API_KEY=your-gateway-api-key

# LLM Provider (choose one)
LLM_PROVIDER=openai  # or 'gemini'

# OpenAI (if LLM_PROVIDER=openai)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini  # or gpt-4o, gpt-4-turbo

# Gemini (if LLM_PROVIDER=gemini)
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-1.5-flash  # or gemini-1.5-pro

# LLM Settings
LLM_MAX_TOKENS=500
LLM_TEMPERATURE=0.7

# Serapod API
SERAPOD_BASE_URL=https://dev.serapod2u.com
SERAPOD_SERVICE_TOKEN=your-agent-api-key
SERAPOD_TENANT_ID=default
SERAPOD_TIMEOUT=10000

# Memory
MEMORY_MAX_TURNS=10
MEMORY_TTL_MS=604800000  # 7 days

# Features
MOLTBOT_AUTO_REPLY=true
MOLTBOT_TOOL_CALLING=true
MOLTBOT_GREETING=true

# Bot Personality
BOT_NAME=Serapod Bot
BOT_LANGUAGE=ms
```

## Installation

```bash
cd moltbot
npm install
```

## Running

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

### With PM2
```bash
pm2 start dist/index.js --name moltbot
```

## API Endpoints

### Webhook (Main)

```
POST /webhook/whatsapp
Headers:
  x-moltbot-secret: <MOLTBOT_WEBHOOK_SECRET>
Body:
{
  "tenantId": "default",
  "from": "60123456789",
  "text": "Hi",
  "pushName": "John"
}
```

### Health Check

```
GET /health
Response: { "status": "ok", "service": "moltbot", ... }
```

### Debug Health (Protected)

```
GET /debug/health?secret=<DEBUG_SECRET>
Response: {
  "status": "ok",
  "config": { ... },
  "memory": { "totalConversations": 5 },
  "tools": ["recognize_user", "get_points_balance", ...]
}
```

### Debug Last Conversation (Protected)

```
GET /debug/last/60123456789?secret=<DEBUG_SECRET>
Response: {
  "found": true,
  "phone": "60123456789",
  "userProfile": { "name": "John", ... },
  "turnCount": 5,
  "recentTurns": [...]
}
```

### Clear Memory (Protected)

```
DELETE /debug/memory/60123456789?secret=<DEBUG_SECRET>
```

### Test AI (Protected)

```
POST /debug/test-ai
Headers:
  x-debug-secret: <DEBUG_SECRET>
Body:
{
  "phone": "60123456789",
  "text": "point saya berapa?"
}
```

### Manual Send (Debug)

```
GET /debug/send?to=60123456789&message=Hello
```

## Available Tools

| Tool | Description |
|------|-------------|
| `recognize_user` | Identify user by phone number |
| `get_points_balance` | Get user's points, tier, and stats |
| `get_recent_orders` | Get user's order history |
| `get_redeem_status` | Get user's redemption history |

## Testing

### 1. Start Moltbot

```bash
npm run dev
```

### 2. Configure Gateway Webhook

In baileys-gateway, ensure webhook is configured:

```json
{
  "webhookUrl": "http://127.0.0.1:4000/webhook/whatsapp",
  "webhookSecret": "your-webhook-secret"
}
```

### 3. Test Scenarios

**Greeting Test:**
```
User: "hi"
Bot: "Hi [Name]! 👋 Ada apa boleh saya bantu hari ni?"
```

**Points Test:**
```
User: "point saya berapa?"
Bot: "Points kamu sekarang ada 1,500. Tier Gold ya! 🎉"
```

**Orders Test:**
```
User: "order saya?"
Bot: "Ada 2 order terkini:
- #SO123 - Shipped ✅
- #SO124 - Pending"
```

**Unknown Module Test:**
```
User: "annual leave saya berapa?"
Bot: "Maaf, buat masa ni modul annual leave belum ada dalam Serapod2u. Kami akan tambah kemudian! 😊"
```

## Troubleshooting

### Bot not responding

1. Check webhook secret matches in gateway and moltbot
2. Verify OPENAI_API_KEY or GEMINI_API_KEY is set
3. Check logs: `pm2 logs moltbot` or terminal output

### Tool calls failing

1. Verify SERAPOD_SERVICE_TOKEN matches AGENT_API_KEY in Serapod
2. Check SERAPOD_BASE_URL is accessible
3. Check Serapod API logs for errors

### Memory issues

1. Increase MEMORY_TTL_MS if conversations expire too fast
2. Check `/debug/health` for memory stats
3. Clear specific user: `DELETE /debug/memory/:phone`

### LLM errors

1. Check API key validity
2. Try switching providers (openai ↔ gemini)
3. Check rate limits

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Unauthorized` | Wrong webhook secret | Check MOLTBOT_WEBHOOK_SECRET |
| `OPENAI_API_KEY is required` | Missing API key | Set OPENAI_API_KEY in .env |
| `Tool 'xxx' not found` | Invalid tool name | Check tool registry |
| `Serapod API error` | API unreachable | Check SERAPOD_BASE_URL |

## Logs

Moltbot uses Pino for structured logging:

```
[INFO] Received WhatsApp message { from: "60123456789", text: "hi" }
[INFO] User recognized { phone: "60123456789", name: "John" }
[INFO] Tool executed { tool: "get_points_balance", durationMs: 150 }
[INFO] Reply sent { to: "60123456789", replyPreview: "Hi John! 👋..." }
```

Set log level with:
```bash
LOG_LEVEL=debug npm run dev
```

## Security Notes

- Never expose API keys in client code
- Webhook secret prevents unauthorized messages
- Debug endpoints require separate secret
- Serapod calls use server-to-server token
- No sensitive data in error responses

## Project Structure

```
moltbot/
├── src/
│   ├── index.ts              # Express server setup
│   ├── config.ts             # Environment configuration
│   ├── types/
│   │   └── index.ts          # TypeScript interfaces
│   ├── providers/
│   │   └── llm.ts            # LLM abstraction (OpenAI/Gemini)
│   ├── services/
│   │   ├── ai.service.ts     # AI orchestration
│   │   ├── gateway.service.ts # WhatsApp gateway client
│   │   ├── memory.ts         # Conversation memory store
│   │   ├── serapod.client.ts # Serapod API client
│   │   └── webhook.handler.ts # Webhook processing
│   ├── tools/
│   │   └── registry.ts       # Tool definitions
│   ├── prompts/
│   │   └── system.ts         # System prompts
│   └── utils/
│       └── logger.ts         # Pino logger
├── .env                      # Environment variables
├── package.json
├── tsconfig.json
└── README.md
```

## Roadmap

### Phase 1 (Current) - Read-Only
- ✅ User recognition
- ✅ Points balance
- ✅ Order status
- ✅ Redeem status

### Phase 2 - Write Actions (Coming)
- [ ] Create support ticket
- [ ] Submit feedback
- [ ] Request callback

### Phase 3 - Advanced
- [ ] AI-suggested products
- [ ] Personalized promotions
- [ ] Multi-language support (WhatsApp Test Bot)

A simple service to test 2-way WhatsApp communication with Baileys Gateway.

## Features
- Inbound Webhook Handler (`POST /webhook/whatsapp`)
- Auto-Reply Logic (Echo + Name)
- Gateway Client (`POST /messages/send`)
- Debug Endpoint (`GET /debug/send`)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure .env:
   Copy `.env.example` to `.env` and update values.
   - `MOLTBOT_WEBHOOK_SECRET`: Should match Gateway's webhook API key.
   - `SERAPOD_WA_API_KEY`: Should match Gateway's API Key.

3. Run:
   ```bash
   npm run dev
   ```

## Usage

### 1. Receive Webhook (from Gateway)
Configure your Baileys Gateway to forward messages to:
`http://localhost:4000/webhook/whatsapp`

Env in Baileys Gateway:
```
WEBHOOK_URL=http://localhost:4000/webhook/whatsapp
WEBHOOK_ENABLED=true
WEBHOOK_API_KEY=secret
```

### 2. Manual Send Test
Call the debug endpoint:
`http://localhost:4000/debug/send?to=60123456789&message=HelloFromMoltbot`
