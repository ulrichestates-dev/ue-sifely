# CLAUDE.md — ue-sifely

Sifely smart-lock backend for Ulrich Estates. Node/Express service on Railway
(auto-deploys on push to `main`). Also exposes an MCP server at `/mcp` (the
`UE_Sifely_MCP` connector). See [README.md](README.md) for the endpoint list.

## Layout

Plain Node (CommonJS), no build step. `node --check index.js` to sanity-check syntax.

```
index.js         Express app + route wiring (open + guarded routes).
auth.js          Sifely token auth.
locks.js         Lock discovery + property mapping.
lock-ops.js      Live keyboard-passcode read/create/delete.
passcodes.js     Reservation-driven per-stay codes.
scheduler.js     Tick that materializes/expires guest codes (5 PM ET checkout, DST-aware).
orchestrator.js  Higher-level flows. webhook.js, alerts.js, records.js support these.
mcp-server.js    MCP tool surface mirroring the REST routes.
```

## Auth model

- **Open routes**: `/health`, `/auth/token`, `/locks`, `/mcp`.
- **Guarded routes** (`/auth-check`, `/lock/*`): require header `x-ue-key` == `UE_SIFELY_KEY`.
  Return `503` if `UE_SIFELY_KEY` is unset (closed by default), `401` on mismatch.
- `UE_SIFELY_KEY` is **shared with the ue-codes service and must be identical there**.
  If they drift, ue-codes shows every lock as "unreachable." `/auth-check` exists so
  ue-codes' `/health` can verify the match without hitting the Sifely cloud.

## Sifely quirks (learned)

- Deleting a code needs `deleteType`: `1` = cloud/offline, `2` = via gateway.
  `-2012` = that lock has no gateway.
- Adding a code: `keyboardPwdType 2`, `addType 1` (self-supplied), real-ms date window.
- Sifely throttles rapid deletes — space them ~800 ms apart.

## Working rules

- OK to merge **non-DB** PRs after verifying (owner authorization). DB/migration PRs gated.
- Ship on a branch → PR into `main`; merging deploys. Refresh README/CLAUDE.md each build.
