import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getToken } from "./auth.js";
import { getAllLocks } from "./locks.js";
import { createCodesForBooking, deleteCodesForBooking, refreshCodesForBooking } from "./orchestrator.js";
import { getRecord, getAllRecords } from "./records.js";
import { runDailyJob } from "./scheduler.js";

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

const TOOLS = [
  { name: "sifely_health",       description: "Check ue-sifely service health.", inputSchema: { type: "object", properties: {} } },
  { name: "sifely_list_locks",   description: "List all Sifely locks with gateway status, battery, and property mapping.", inputSchema: { type: "object", properties: {} } },
  { name: "sifely_create_passcode", description: "Generate guest access codes for a booking across all mapped locks.", inputSchema: bookingSchema },
  { name: "sifely_delete_passcode", description: "Delete all lock codes for a reservation (e.g. on cancellation).", inputSchema: { type: "object", properties: { hostawayReservationId: { type: "string" } }, required: ["hostawayReservationId"] } },
  { name: "sifely_refresh_passcode", description: "Delete and regenerate codes for a booking (e.g. on date change).", inputSchema: bookingSchema },
  { name: "sifely_get_passcode_record", description: "Look up the stored passcode record for one reservation.", inputSchema: { type: "object", properties: { reservationId: { type: "string" } }, required: ["reservationId"] } },
  { name: "sifely_list_passcodes", description: "List all stored passcode records (active, deleted, failed).", inputSchema: { type: "object", properties: {} } },
  { name: "sifely_run_scheduler", description: "Manually trigger the daily check-in code generation job.", inputSchema: { type: "object", properties: {} } },
];

const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const fail = (msg) => ({ content: [{ type: "text", text: `Error: ${msg}` }], isError: true });

export function createMcpServer() {
  const server = new Server({ name: "ue-sifely", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      switch (name) {
        case "sifely_health":
          return ok({ status: "ok", service: "ue-sifely" });
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
        default:
          return fail(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return fail(err.message);
    }
  });

  return server;
}
