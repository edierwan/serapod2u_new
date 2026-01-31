# Baileys Gateway for Serapod2u

A production-grade WhatsApp Gateway using @whiskeysockets/baileys with HTTP API for remote control from Serapod Admin UI.

## Features

- ✅ WhatsApp connection via QR code
- ✅ Remote session management (reset, logout, reconnect)
- ✅ QR code generation for UI display
- ✅ Send text messages via API
- ✅ Connection status monitoring
- ✅ API key authentication
- ✅ Rate limiting for sensitive endpoints
- ✅ Graceful shutdown handling
- ✅ Auto-reconnection on disconnect

## Requirements

- Node.js 18+ 
- PM2 (for production deployment)
- A VPS with public IP or domain

## Quick Start

### 1. Install Dependencies

```bash
cd baileys-gateway
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set your API key:

```bash
# Generate a secure API key
API_KEY=$(openssl rand -hex 32)
echo "API_KEY=$API_KEY"
```

### 3. Build & Run

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

**With PM2:**
```bash
npm run build
npm run pm2:start
```

## API Endpoints

### Public Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (no auth) |

### Protected Endpoints (require `x-api-key` header)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Get connection status |
| `/session/qr` | GET | Get QR code for pairing |
| `/session/reset` | POST | Reset session (change number) |
| `/session/logout` | POST | Logout from WhatsApp |
| `/session/reconnect` | POST | Reconnect without reset |
| `/messages/send` | POST | Send a message |
| `/send` | POST | Alias for `/messages/send` |

### Example Requests

**Check Status:**
```bash
curl -H "x-api-key: YOUR_API_KEY" http://localhost:3001/status
```

**Send Message:**
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"to": "60192277233", "text": "Hello from Serapod!"}' \
  http://localhost:3001/messages/send
```

## Response Formats

### Status Response
```json
{
  "connected": true,
  "pairing_state": "connected",
  "phone_number": "60192277233",
  "push_name": "Serapod HQ",
  "last_connected_at": "2026-01-31T10:30:00.000Z",
  "last_error": null,
  "uptime": 3600
}
```

### QR Response
```json
{
  "qr": "data:image/png;base64,iVBORw0KGgo...",
  "expires_in_sec": 25
}
```

### Message Send Response
```json
{
  "ok": true,
  "message_id": "3EB0ABC123..."
}
```

## PM2 Management

```bash
# Start
pm2 start dist/index.js --name baileys-gateway

# Status
pm2 status baileys-gateway

# Logs
pm2 logs baileys-gateway

# Restart
pm2 restart baileys-gateway

# Stop
pm2 stop baileys-gateway

# Delete
pm2 delete baileys-gateway

# Save PM2 process list
pm2 save

# Set PM2 to start on boot
pm2 startup
```

## Nginx Reverse Proxy (Recommended)

Create `/etc/nginx/sites-available/wa.serapod2u.com`:

```nginx
server {
    listen 80;
    server_name wa.serapod2u.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name wa.serapod2u.com;

    ssl_certificate /etc/letsencrypt/live/wa.serapod2u.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wa.serapod2u.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/wa.serapod2u.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## SSL with Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d wa.serapod2u.com
```

## Firewall Configuration

Allow only your Serapod server IP (optional but recommended):

```bash
# Using UFW
sudo ufw allow from YOUR_SERAPOD_SERVER_IP to any port 3001

# Or allow all (less secure)
sudo ufw allow 3001
```

## Troubleshooting

### QR Code not appearing
1. Check if the gateway is running: `pm2 status`
2. Check logs: `pm2 logs baileys-gateway`
3. Try resetting: `curl -X POST -H "x-api-key: KEY" http://localhost:3001/session/reset`

### Connection keeps dropping
1. Ensure WhatsApp app is up to date
2. Check if the phone has stable internet
3. Don't scan QR with multiple devices

### Messages not sending
1. Verify the phone number format (e.g., `60192277233`)
2. Check if connected: `/status` should show `connected: true`
3. Check logs for detailed error messages

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP server port |
| `HOST` | `0.0.0.0` | Bind address |
| `API_KEY` | - | Required for authentication |
| `AUTH_PATH` | `./auth` | Session storage directory |
| `ALLOWED_ORIGINS` | `*` | CORS origins (comma-separated) |
| `LOG_LEVEL` | `info` | Pino log level |
| `QR_EXPIRY_SECONDS` | `30` | QR code validity |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Max requests per window |

## Directory Structure

```
baileys-gateway/
├── src/
│   ├── index.ts           # Main entry point
│   ├── services/
│   │   └── baileys.service.ts  # Baileys connection management
│   └── utils/
│       └── logger.ts      # Pino logger configuration
├── auth/                  # WhatsApp session files (auto-created)
├── dist/                  # Compiled JavaScript
├── package.json
├── tsconfig.json
└── .env
```

## License

Internal use only - Serapod2u
