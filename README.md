# Serapod2u

Monorepo for the Serapod2u platform: supply-chain / ERP web app, WhatsApp services, shared helpers, and Supabase schema.

## Repository map

| Path | Role |
|------|------|
| [`app/`](app/) | **Main product** — Next.js app (UI, API routes, business logic). Deployed via the root `Dockerfile`. |
| [`supabase/`](supabase/) | Database migrations, SQL, and related schema work. |
| [`baileys-gateway/`](baileys-gateway/) | Self-hosted WhatsApp gateway (Baileys). Separate Node service. |
| [`moltbot/`](moltbot/) | AI-powered WhatsApp bot service. Separate Node service. |
| [`shared/`](shared/) | Small shared utilities used across services (e.g. phone helpers). |
| [`scripts/`](scripts/) | One-off / ops SQL and tooling scripts (not part of the web runtime). |
| [`docs/`](docs/) | Runbooks, assessments, module notes, and archived SQL. See [`docs/README.md`](docs/README.md). |
| [`.github/`](.github/) | CI / GitHub workflows. |

## App layout (`app/src`)

| Path | Role |
|------|------|
| `app/` | Next.js App Router pages and API routes |
| `components/` | UI by domain (inventory, HR, orders, …) |
| `modules/` | Module shells / nav / landing views |
| `lib/` | Domain logic, helpers, server utilities |
| `hooks/`, `config/`, `styles/`, `types/` | Shared React hooks, config, CSS, types |

## Local development (web app)

```bash
cd app
npm install
npm run dev
```

- Node: see `app/.nvmrc` / `engines` in `app/package.json` (currently **22.21.x**).
- Dev server: `http://localhost:3000` (`predev` frees the port via `scripts/free-port.js`).
- Tests: `cd app && npm test`

WhatsApp services (`baileys-gateway`, `moltbot`) each have their own `package.json` and `.env.example` — run them separately when working on messaging.

## Deploy note

The root `Dockerfile` builds **`app/` only**. Gateway and bot services are deployed independently.

## Docs

Start at [`docs/README.md`](docs/README.md) for runbooks and historical assessments. Do not put one-off personal IDE files or phone dumps in the repo root.
