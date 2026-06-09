import { getToken }                                      from "./auth.js";
import { PROPERTY_LOCK_MAP }                             from "./locks.js";
import { generatePasscode, deletePasscode }              from "./passcodes.js";
import { saveRecord, getRecord, markDeleted, markFailed } from "./records.js";
import { sendAlert }                                     from "./alerts.js";

const HOSTAWAY_API = process.env.HOSTAWAY_API_URL || "https://api.hostaway.com/v1";
const HOSTAWAY_KEY = process.env.HOSTAWAY_API_KEY;

const FIELD_MAP = {
  unitCode: {
    airbnb:        48236,
    "booking.com": 48237,
    vrbo:          48238,
    direct:        48239,
    partners:      95193,
  },
  entranceCode: {
    airbnb:        71501,
    "booking.com": 79267,
    vrbo:          79268,
    direct:        71501,
    partners:      95192,
  },
  backdoorCode: { all: 84840 },
};

export async function createCodesForBooking(booking) {
  const { hostawayReservationId, hostawayListingId, guestFirstName, guestLastName, platform, checkIn, checkOut } = booking;
  const guestLabel  = buildGuestLabel(guestLastName, platform, checkIn);
  const platformKey = normalizePlatform(platform);

  const unitLocks     = PROPERTY_LOCK_MAP.filter(p => p.hostawayId === hostawayListingId && p.lockId !== null && p.access !== "none");
  const entranceLocks = getEntranceLocks(hostawayListingId);
  const allLocks      = dedupeByLockId([...unitLocks, ...entranceLocks]);

  if (allLocks.length === 0) {
    console.log(`[orchestrator] No Sifely locks for listing ${hostawayListingId} — skipping`);
    return { skipped: true, reason: "no_sifely_locks" };
  }

  console.log(`[orchestrator] Generating codes for reservation ${hostawayReservationId} — ${allLocks.length} lock(s)`);

  const token       = await getToken();
  const lockResults = [];
  let hasAnyFailure  = false;
  let hasAnyFallback = false;

  for (const lock of allLocks) {
    try {
      const result = await generatePasscode(token, { lockId: lock.lockId, hasGateway: lock.hasGateway, guestLabel, checkIn, checkOut });
      lockResults.push({ lockId: lock.lockId, role: lock.role, address: lock.address, code: result.code, pwdId: result.pwdId, strategy: result.strategy, fallback: result.fallback, fallbackReason: result.fallbackReason ?? null });
      if (result.fallback) hasAnyFallback = true;
    } catch (err) {
      console.error(`[orchestrator] Lock ${lock.lockId} failed: ${err.message}`);
      lockResults.push({ lockId: lock.lockId, role: lock.role, address: lock.address, code: null, pwdId: null, error: err.message });
      hasAnyFailure = true;
    }
  }

  const record = { hostawayReservationId, hostawayListingId, guestName: `${guestFirstName} ${guestLastName}`, guestLabel, platform: platformKey, checkIn, checkOut, locks: lockResults };

  if (hasAnyFailure) {
    markFailed(hostawayReservationId, new Error("One or more locks failed"));
    Object.assign(record, { status: "partial" });
  } else {
    saveRecord(hostawayReservationId, record);
  }

  const propertyName = allLocks[0]?.address ?? `Listing ${hostawayListingId}`;

  if (hasAnyFallback || hasAnyFailure) {
    await sendAlert({
      level:         hasAnyFailure ? "error" : "warning",
      property:      propertyName,
      guestName:     `${guestFirstName} ${guestLastName}`,
      platform:      platformKey,
      checkIn,
      reservationId: hostawayReservationId,
      locks:         lockResults,
      message:       hasAnyFailure
        ? "One or more lock codes could not be generated. Manual entry required."
        : "Gateway was unreachable — offline code used instead. Code is valid.",
    });
  }

  await updateHostawayFields({ hostawayListingId, platformKey, lockResults });

  return { success: !hasAnyFailure, record };
}

export async function deleteCodesForBooking(hostawayReservationId) {
  const record = getRecord(hostawayReservationId);
  if (!record) { console.log(`[orchestrator] No record for ${hostawayReservationId}`); return { skipped: true }; }
  const token   = await getToken();
  const results = [];
  for (const lock of record.locks) {
    if (!lock.pwdId) continue;
    try {
      await deletePasscode(token, { lockId: lock.lockId, pwdId: lock.pwdId });
      results.push({ lockId: lock.lockId, deleted: true });
    } catch (err) {
      console.error(`[orchestrator] Delete failed for lock ${lock.lockId}: ${err.message}`);
      results.push({ lockId: lock.lockId, deleted: false, error: err.message });
    }
  }
  markDeleted(hostawayReservationId);
  return { success: true, results };
}

export async function refreshCodesForBooking(booking) {
  await deleteCodesForBooking(booking.hostawayReservationId);
  return await createCodesForBooking(booking);
}

function buildGuestLabel(lastName, platform, checkIn) {
  const date = new Date(checkIn).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${lastName} — ${normalizePlatform(platform)} — ${date}`;
}

function normalizePlatform(platform) {
  if (!platform) return "direct";
  const p = platform.toLowerCase();
  if (p.includes("airbnb"))                     return "airbnb";
  if (p.includes("booking"))                    return "booking.com";
  if (p.includes("vrbo") || p.includes("homeaway")) return "vrbo";
  return "direct";
}

function getEntranceLocks(hostawayListingId) {
  const entranceMap = {
    471403: [27347090], 477004: [27347090], 479570: [27347090],
    406539: [23474674], 412479: [23474674], 412478: [23474674],
    478632: [27822936],
  };
  const ids = entranceMap[hostawayListingId] ?? [];
  return PROPERTY_LOCK_MAP.filter(p => ids.includes(p.lockId));
}

function dedupeByLockId(locks) {
  const seen = new Set();
  return locks.filter(l => { if (seen.has(l.lockId)) return false; seen.add(l.lockId); return true; });
}

async function updateHostawayFields({ hostawayListingId, platformKey, lockResults }) {
  if (!HOSTAWAY_KEY) { console.warn("[orchestrator] HOSTAWAY_API_KEY not set — skipping field update"); return; }
  const unitLock     = lockResults.find(l => l.role === "unit"                          && l.code);
  const entranceLock = lockResults.find(l => l.role === "entrance"                      && l.code);
  const backdoorLock = lockResults.find(l => (l.role === "back" || l.role === "primary") && l.code);
  const updates = [];
  if (unitLock)     updates.push({ customFieldId: FIELD_MAP.unitCode[platformKey]     ?? FIELD_MAP.unitCode.direct,     value: `${unitLock.code}#`     });
  if (entranceLock) updates.push({ customFieldId: FIELD_MAP.entranceCode[platformKey] ?? FIELD_MAP.entranceCode.direct, value: `${entranceLock.code}#` });
  if (backdoorLock) updates.push({ customFieldId: FIELD_MAP.backdoorCode.all,                                           value: `${backdoorLock.code}#` });
  for (const update of updates) {
    try {
      await fetch(`${HOSTAWAY_API}/listings/${hostawayListingId}/customFieldValues`, {
        method: "POST",
        headers: { Authorization: `Bearer ${HOSTAWAY_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      console.log(`[orchestrator] Updated Hostaway field ${update.customFieldId}`);
    } catch (err) {
      console.error(`[orchestrator] Hostaway field update failed: ${err.message}`);
    }
  }
}
