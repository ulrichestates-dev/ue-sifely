# ue-sifely

Ulrich Estates — Sifely smart lock integration service.

Deployed on Railway (auto-deploys on push to `main`). Provides HTTP endpoints for
lock discovery, live passcode management, and reservation-driven code automation.
Also exposes an MCP server at `/mcp` (used by the `UE_Sifely_MCP` connector).

## Endpoints

**Open** (no key):

| Method | Endpoint       | Purpose                                      |
|--------|----------------|----------------------------------------------|
| GET    | /health        | Confirms service is running                  |
| POST   | /auth/token    | Authenticate with Sifely, returns token      |
| GET    | /locks         | List all locks with gateway status + mapping |
| */mcp  | /mcp           | MCP server (tools mirror the routes here)    |

**Guarded** — require the `x-ue-key` header to equal `UE_SIFELY_KEY`. Used by the
`ue-codes` office app for live lock-code management. Return `503` if the service has
no key configured, `401` if the caller's key doesn't match:

| Method | Endpoint              | Purpose                                          |
|--------|-----------------------|--------------------------------------------------|
| GET    | /auth-check           | Verify the shared key matches (no Sifely call)   |
| GET    | /lock/:lockId/codes   | List live keyboard passcodes on a lock           |
| POST   | /lock/code/create     | Add a code (custom/auto, named, with expiry)     |
| POST   | /lock/code/delete     | Delete one code (needs `deleteType`)             |

> **Deleting codes** needs a `deleteType`: `1` = cloud/offline, `2` = via gateway
> (`-2012` = no gateway on that lock). Sifely throttles rapid deletes, so space them
> ~800 ms apart.

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
| UE_SIFELY_KEY         | Shared secret guarding the `/lock/*` + `/auth-check` routes. **Must be identical to `UE_SIFELY_KEY` on the ue-codes service** — if they drift, ue-codes shows every lock as "unreachable." Unset = guarded routes return `503`. |
| HOSTAWAY_API_KEY / HOSTAWAY_API_URL / HOSTAWAY_ACCOUNT_ID | Reservation lookup for per-stay code automation |
| SLACK_LOCK_ALERTS_WEBHOOK | Slack channel for lock-code alerts |
| TZ                    | Timezone for the scheduler (Eastern)         |

## Reservation-driven automation

- `POST /passcode/create` — generate a timed code for a reservation's stay
- `POST /passcode/delete` — revoke a code
- `POST /passcode/refresh` / `GET /passcode/:reservationId` / `GET /passcodes`
- `POST /scheduler/run` — the tick that materializes/expires codes (guest codes end
  at 5 PM ET on checkout day, DST-aware)
