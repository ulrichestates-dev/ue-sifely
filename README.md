# ue-sifely

Ulrich Estates — Sifely smart lock integration service.

Deployed on Railway. Provides HTTP endpoints for lock discovery and (Phase 2) automated passcode management.

## Phase 1 — Lock Discovery

| Method | Endpoint       | Purpose                                      |
|--------|----------------|----------------------------------------------|
| GET    | /health        | Confirms service is running                  |
| POST   | /auth/token    | Authenticate with Sifely, returns token      |
| GET    | /locks         | List all locks with gateway status           |

## Setup

### Local dev

```bash
npm install
cp .env.example .env   # fill in credentials
npm run dev
```

Then visit: `http://localhost:3000/locks`

### Railway deployment

1. Push this repo to GitHub
2. Railway → New Project → Deploy from GitHub repo
3. Add environment variables from `.env.example` under Railway → Variables
4. Railway auto-deploys on every push to `main`

## Environment variables

| Variable              | Description                        |
|-----------------------|------------------------------------|
| SIFELY_BASE_URL       | Sifely API base URL                |
| SIFELY_CLIENT_ID      | From Sifely API Access portal      |
| SIFELY_CLIENT_SECRET  | From Sifely API Access portal      |
| SIFELY_USERNAME       | Sifely account email               |
| SIFELY_PASSWORD       | Sifely account password            |
| PORT                  | HTTP port (Railway sets this auto) |

## Phase 2 (coming)

Once lock IDs are mapped to properties:
- `POST /passcode/create` — generate timed code on check-in date
- `POST /passcode/delete` — revoke code on cancellation
