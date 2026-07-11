import "dotenv/config";
import express                                           from "express";
import { getToken }                                      from "./auth.js";
import { getAllLocks }                                   from "./locks.js";
import { listLockCodes, deleteLockCode, addLockCode }    from "./lock-ops.js";
import { webhookRouter }                                 from "./webhook.js";
import { startScheduler, runDailyJob }                  from "./scheduler.js";
import { createCodesForBooking, deleteCodesForBooking, refreshCodesForBooking } from "./orchestrator.js";
import { getRecord, getAllRecords }                      from "./records.js";
import { createMcpServer }                               from "./mcp-server.js";
import { StreamableHTTPServerTransport }                  from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// Shared-secret guard for the code read/create/delete routes that ue-codes calls.
// Closed with 503 until UE_SIFELY_KEY is set, so it's never accidentally open.
function requireUeKey(req, res, next) {
  const expected = process.env.UE_SIFELY_KEY;
  if (!expected) return res.status(503).json({ error: "UE_SIFELY_KEY not configured" });
  if (req.get("x-ue-key") !== expected) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.post("/mcp", async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

app.delete("/mcp", (req, res) => res.status(200).end());

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "ue-sifely", version: "2.0.0", timestamp: new Date().toISOString() });
});

app.post("/auth/token", async (req, res) => {
  try { const token = await getToken(); res.json({ success: true, token }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get("/locks", async (req, res) => {
  try { const token = await getToken(); const locks = await getAllLocks(token); res.json({ success: true, count: locks.length, locks }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// --- Guarded routes for ue-codes (live code read / create / delete) ---

// List the live keyboard passcodes on a lock.
app.get("/lock/:lockId/codes", requireUeKey, async (req, res) => {
  try {
    const token = await getToken();
    const data = await listLockCodes(token, {
      lockId: Number(req.params.lockId),
      pageNo: Number(req.query.pageNo) || 1,
      pageSize: Number(req.query.pageSize) || 100,
    });
    res.json({ success: true, ...data });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Create one keyboard passcode (custom digits or auto + name + validity window).
app.post("/lock/code/create", requireUeKey, async (req, res) => {
  try {
    const { lockId, code, name, startDate, endDate } = req.body || {};
    if (!lockId || !startDate || !endDate) return res.status(400).json({ error: "lockId, startDate and endDate are required" });
    const token = await getToken();
    const result = await addLockCode(token, { lockId: Number(lockId), code, name, startDate, endDate });
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Delete one keyboard passcode by id.
app.post("/lock/code/delete", requireUeKey, async (req, res) => {
  try {
    const { lockId, keyboardPwdId } = req.body || {};
    if (!lockId || !keyboardPwdId) return res.status(400).json({ error: "lockId and keyboardPwdId are required" });
    const token = await getToken();
    const result = await deleteLockCode(token, { lockId: Number(lockId), keyboardPwdId: Number(keyboardPwdId) });
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post("/passcode/create", async (req, res) => {
  try {
    const required = ["hostawayReservationId", "hostawayListingId", "guestFirstName", "guestLastName", "checkIn", "checkOut"];
    for (const f of required) { if (!req.body[f]) return res.status(400).json({ error: `Missing field: ${f}` }); }
    const result = await createCodesForBooking(req.body);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post("/passcode/delete", async (req, res) => {
  try {
    const { hostawayReservationId } = req.body;
    if (!hostawayReservationId) return res.status(400).json({ error: "Missing hostawayReservationId" });
    const result = await deleteCodesForBooking(hostawayReservationId);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post("/passcode/refresh", async (req, res) => {
  try { const result = await refreshCodesForBooking(req.body); res.json({ success: true, ...result }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get("/passcode/:reservationId", async (req, res) => {
  try {
    const record = await getRecord(req.params.reservationId);
    if (!record) return res.status(404).json({ error: "Record not found" });
    res.json({ success: true, record });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get("/passcodes", async (req, res) => {
  try {
    const records = await getAllRecords();
    res.json({ success: true, count: records.length, records });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post("/scheduler/run", async (req, res) => {
  try { const result = await runDailyJob(); res.json({ success: true, ...result }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.use("/webhook", webhookRouter);

app.listen(PORT, () => {
  console.log(`ue-sifely v2 running on port ${PORT}`);
  startScheduler();
});
