import cron from "node-cron";
import { createCodesForBooking } from "./orchestrator.js";

const HOSTAWAY_API = process.env.HOSTAWAY_API_URL || "https://api.hostaway.com/v1";
const HOSTAWAY_KEY = process.env.HOSTAWAY_API_KEY;
const HOSTAWAY_ID  = process.env.HOSTAWAY_ACCOUNT_ID;

// Token cache
let cachedHAToken = null;
let haTokenExpiry = null;

export async function getHostawayToken() {
  if (cachedHAToken && haTokenExpiry && Date.now() < haTokenExpiry - 60000) {
    return cachedHAToken;
  }
  const res = await fetch(`${HOSTAWAY_API}/accessTokens`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     HOSTAWAY_ID,
      client_secret: HOSTAWAY_KEY,
      scope:         "general",
    }),
  });
  if (!res.ok) throw new Error(`Hostaway auth failed: ${res.status}`);
  const data = await res.json();
  cachedHAToken = data.access_token;
  haTokenExpiry = Date.now() + (data.expires_in * 1000);
  console.log("[scheduler] Hostaway token refreshed");
  return cachedHAToken;
}

export function startScheduler() {
  if (!HOSTAWAY_KEY || !HOSTAWAY_ID) {
    console.warn("[scheduler] HOSTAWAY_API_KEY or HOSTAWAY_ACCOUNT_ID not set — scheduler disabled");
    return;
  }
  cron.schedule("0 8 * * *", async () => {
    console.log(`[scheduler] Running 8 AM job — ${new Date().toISOString()}`);
    await runDailyJob();
  }, { timezone: "America/New_York" });
  console.log("[scheduler] 8 AM daily job scheduled (America/New_York)");
}

export async function runDailyJob() {
  const today = new Date().toLocaleDateString("en-CA");
  console.log(`[scheduler] Fetching check-ins for ${today}`);
  let reservations;
  try { reservations = await fetchTodaysCheckIns(today); }
  catch (err) { console.error(`[scheduler] Failed to fetch check-ins: ${err.message}`); return { error: err.message }; }
  console.log(`[scheduler] Found ${reservations.length} check-in(s)`);
  const results = [];
  for (const res of reservations) {
    try {
      const result = await createCodesForBooking(res);
      results.push({ reservationId: res.hostawayReservationId, ...result });
    } catch (err) {
      console.error(`[scheduler] Failed for ${res.hostawayReservationId}: ${err.message}`);
      results.push({ reservationId: res.hostawayReservationId, error: err.message });
    }
  }
  console.log(`[scheduler] Done. ${results.filter(r => r.success).length}/${results.length} succeeded`);
  return { date: today, results };
}

async function fetchTodaysCheckIns(date) {
  const token  = await getHostawayToken();
  const params = new URLSearchParams({
    arrivalStartDate: date,
    arrivalEndDate:   date,
    status:           "confirmed",
    limit:            "50",
  });
  const res = await fetch(`${HOSTAWAY_API}/reservations?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Hostaway API error: ${res.status}`);
  const data = await res.json();
  return (data.result ?? []).map(r => ({
    hostawayReservationId: String(r.id),
    hostawayListingId:     r.listingMapId,
    guestFirstName:        r.guestName?.split(" ")[0] ?? "Guest",
    guestLastName:         r.guestName?.split(" ").slice(1).join(" ") ?? r.guestName ?? "Guest",
    platform:              r.channelName ?? "direct",
    checkIn:               r.arrivalDate,
    checkOut:              r.departureDate,
  }));
}
