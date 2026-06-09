/**
 * ue-sifely — Ulrich Estates Sifely Integration Service
 * Phase 1: Lock Discovery
 *
 * Endpoints:
 *   GET  /health        → confirms service is running
 *   POST /auth/token    → authenticate with Sifely, returns cached token
 *   GET  /locks         → list all locks with gateway status
 */

import "dotenv/config";
import express from "express";
import { getToken } from "./auth.js";
import { getAllLocks } from "./locks.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "ue-sifely", timestamp: new Date().toISOString() });
});

// ── Auth: get token ───────────────────────────────────────────────────────────
app.post("/auth/token", async (req, res) => {
  try {
    const token = await getToken();
    res.json({ success: true, token });
  } catch (err) {
    console.error("[/auth/token]", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Locks: discovery ─────────────────────────────────────────────────────────
app.get("/locks", async (req, res) => {
  try {
    const token = await getToken();
    const locks = await getAllLocks(token);
    res.json({ success: true, count: locks.length, locks });
  } catch (err) {
    console.error("[/locks]", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`ue-sifely running on port ${PORT}`);
});
