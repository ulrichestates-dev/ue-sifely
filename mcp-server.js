import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getToken } from "./auth.js";
import { getAllLocks } from "./locks.js";
import { createCodesForBooking, deleteCodesForBooking, refreshCodesForBooking } from "./orchestrator.js";
import { getRecord, getAllRecords } from "./records.js";
import { runDailyJob } from "./scheduler.js";
import {
  listLockCodes, lockRecords, lockDetail, queryLockState,
  addLockCode, deleteLockCode, changeLockCode, remoteUnlock, remoteLock,
} from "./lock-ops.js";

const bookingSchema = {
  type: "object",
  properties: {
    hostawayReservationId: { type: "string" },
    hostawayListingId:     { type: "number" },
    guestFirstName:        { type: "string" },
    guestLastName:         { type: "string" },
    platform:              { type: "string", description: "airbnb | booking.com | vrbo | direct" },
    checkIn:               { type: "string", description: "ISO date" },
    checkOut:              { type: "string", description: "ISO date" },
  },
  required: ["hostawayReservationId", "hostawayListingId", "guestFirstName", "guestLastName", "checkIn", "checkOut"],
};

const lockIdOnly = { type: "object", properties: { lockId: { type: "number" } }, required: ["lockId"] };

const TOOLS = [
  // service + reservation-level
  { name: "sifely_health",       description: "Check ue-sifely service health.", inputSchema: { type: "object", properties: {} } },
  { name: "sifely_list_locks",   description: "List all Sifely locks with gateway status, battery, and property mapping.", inputSchema: { type: "object", properties: {} } },
  { name: "sifely_create_passcode", description: "Generate guest access codes for a booking across all mapped locks.", inputSchema: bookingSchema },
  { name: "sifely_delete_passcode", description: "Delete all lock codes for a reservation (e.g. on cancellation).", inputSchema: { type: "object", properties: { hostawayReservationId: { type: "string" } }, required: ["hostawayReservationId"] } },
  { name: "sifely_refresh_passcode", description: "Delete and regenerate codes for a booking (e.g. on date change).", inputSchema: bookingSchema },
  { name: "sifely_get_passcode_record", description: "Look up the stored passcode record for one reservation.", inputSchema: { type: "object", properties: { reservationId: { type: "string" } }, required: ["reservationId"] } },
  { name: "sifely_list_passcodes", description: "List all stored passcode records (active, deleted, failed).", inputSchema: { type: "object", properties: {} } },
  { name: "sifely_run_scheduler", description: "Manually trigger the daily check-in code generation job.", inputSchema: { type: "object", properties: {} } },

  // direct per-lock — read
  { name: "sifely_list_lock_codes", description: "List every active keyboard passcode ON a specific lock (returns each code + keyboardPwdId). Use this to see codes not created by the automation.", inputSchema: { type: "object", properties: { lockId: { type: "number" }, pageNo: { type: "number" }, pageSize: { type: "number" } }, required: ["lockId"] } },
  { name: "sifely_lock_records", description: "List access/entry records (who opened, when) for a specific lock.", inputSchema: { type: "object", properties: { lockId: { type: "number" }, pageNo: { type: "number" }, pageSize: { type: "number" } }, required: ["lockId"] } },
  { name: "sifely_lock_detail", description: "Get full detail for a specific lock.", inputSchema: lockIdOnly },
  { name: "sifely_query_lock_state", description: "Query open/closed state of a lock (gateway locks only).", inputSchema: lockIdOnly },

  // direct per-lock — write
  { name: "sifely_add_lock_code", description: "Add a keyboard passcode directly to a lock (no reservation). Provide code or one is generated. Dates optional (ISO or ms).", inputSchema: { type: "object", properties: { lockId: { type: "number" }, code: { type: "string" }, name: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" } }, required: ["lockId"] } },
  { name: "sifely_delete_lock_code", description: "Delete a single passcode from a lock by keyboardPwdId (get the id from sifely_list_lock_codes).", inputSchema: { type: "object", properties: { lockId: { type: "number" }, keyboardPwdId: { type: "number" }, deleteType: { type: "number", description: "Optional. 2 = via gateway, 1 = non-gateway/cloud. Omit to auto-detect (tries 2, falls back to 1 for offline locks)." } }, required: ["lockId", "keyboardPwdId"] } },
  { name: "sifely_change_lock_code", description: "Change an existing passcode on a lock (new digits and/or new validity window).", inputSchema: { type: "object", properties: { lockId: { type: "number" }, keyboardPwdId: { type: "number" }, newCode: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" } }, required: ["lockId", "keyboardPwdId"] } },
  { name: "sifely_remote_unlock", description: "Remotely unlock a lock (gateway locks only).", inputSchema: lockIdOnly },
  { name: "sifely_remote_lock", description: "Remotely lock a lock (gateway locks only).", inputSchema: lockIdOnly },
];

const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const fail = (msg) => ({ content: [{ type: "text", text: `Error: ${msg}` }], isError: true });

export function createMcpServer() {
  const server = new Server({ name: "ue-sifely", version: "2.1.1" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    try {
      switch (name) {
        case "sifely_health":
          return ok({ status: "ok", service: "ue-sifely", version: "2.1.1" });
        case "sifely_list_locks": {
          const token = await getToken();
          const locks = await getAllLocks(token);
          return ok({ count: locks.length, locks });
        }
        case "sifely_create_passcode":
          return ok(await createCodesForBooking(args));
        case "sifely_delete_passcode":
          return ok(await deleteCodesForBooking(args.hostawayReservationId));
        case "sifely_refresh_passcode":
          return ok(await refreshCodesForBooking(args));
        case "sifely_get_passcode_record": {
          const record = await getRecord(args.reservationId);
          return record ? ok(record) : ok({ error: "Record not found" });
        }
        case "sifely_list_passcodes": {
          const records = await getAllRecords();
          return ok({ count: records.length, records });
        }
        case "sifely_run_scheduler":
          return ok(await runDailyJob());

        // direct per-lock — read
        case "sifely_list_lock_codes":
          return ok(await listLockCodes(await getToken(), args));
        case "sifely_lock_records":
          return ok(await lockRecords(await getToken(), args));
        case "sifely_lock_detail":
          return ok(await lockDetail(await getToken(), args));
        case "sifely_query_lock_state":
          return ok(await queryLockState(await getToken(), args));

        // direct per-lock — write
        case "sifely_add_lock_code":
          return ok(await addLockCode(await getToken(), args));
        case "sifely_delete_lock_code":
          return ok(await deleteLockCode(await getToken(), args));
        case "sifely_change_lock_code":
          return ok(await changeLockCode(await getToken(), args));
        case "sifely_remote_unlock":
          return ok(await remoteUnlock(await getToken(), args));
        case "sifely_remote_lock":
          return ok(await remoteLock(await getToken(), args));

        default:
          return fail(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return fail(err.message);
    }
  });

  return server;
}
