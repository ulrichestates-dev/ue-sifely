/**
 * locks.js — Sifely lock discovery
 *
 * Fetches two sources:
 *   /v3/lock/list  — locks we own (admin)
 *   /v3/key/list   — locks we have ekey access to (secondary admin)
 *
 * Gateway detection uses _raw.hasGateway (1 = yes, 0 = no) from the lock
 * record. The listGateway endpoint is unreliable for shared/proximity gateways.
 *
 * Property mapping is hardcoded from confirmed Hostaway + Sifely data.
 */

const BASE_URL = process.env.SIFELY_BASE_URL || "https://app-smart-server.sifely.com";

// Confirmed property → lock mapping
// access: "owner" | "ekey"
// role: "entrance" | "unit" | "back"
// hostawayId: Hostaway listing ID
export const PROPERTY_LOCK_MAP = [
  // 48 Quincy St — gateway capable, multi-unit
  { hostawayId: 471403, address: "48 Quincy St U1",          lockId: 27347108, role: "unit",     access: "owner", hasGateway: true  },
  { hostawayId: 477004, address: "48 Quincy St U2",          lockId: 27347350, role: "unit",     access: "owner", hasGateway: true  },
  { hostawayId: 479570, address: "48 Quincy St U3",          lockId: 27347478, role: "unit",     access: "owner", hasGateway: true  },
  { hostawayId: null,   address: "48 Quincy Shared Entrance",lockId: 27347090, role: "entrance", access: "owner", hasGateway: true  },

  // 246 Broadway — gateway capable, multi-unit
  { hostawayId: 406539, address: "246 Broadway U1",          lockId: 23474456, role: "unit",     access: "owner", hasGateway: true  },
  { hostawayId: 412479, address: "246 Broadway U2",          lockId: 23473522, role: "unit",     access: "owner", hasGateway: true  },
  { hostawayId: 412478, address: "246 Broadway Full House",  lockId: null,     role: "unit",     access: "owner", hasGateway: true, multiLock: [23474456, 23473522] },
  { hostawayId: null,   address: "246 Broadway Entrance",    lockId: 23474674, role: "entrance", access: "owner", hasGateway: true  },

  // 14 Kenneth Rd — gateway capable
  { hostawayId: 227443, address: "14 Kenneth Rd",            lockId: 12407212, role: "unit",     access: "owner", hasGateway: true  },

  // Offline-only properties
  { hostawayId: 323585, address: "39 Logan Ave",             lockId: 24747636, role: "entrance", access: "owner", hasGateway: false },
  { hostawayId: 323585, address: "39 Logan Ave Back",        lockId: 24747430, role: "back",     access: "owner", hasGateway: false },
  { hostawayId: 457267, address: "22 Walter St U1",          lockId: 27328844, role: "unit",     access: "owner", hasGateway: false },
  { hostawayId: 229256, address: "90 Kensington Ave 1R",     lockId: 26145004, role: "unit",     access: "owner", hasGateway: false },
  { hostawayId: 161072, address: "88 Boylston St U3",        lockId: 7093546,  role: "unit",     access: "owner", hasGateway: false },
  { hostawayId: 161069, address: "45 Hamilton Unit B",       lockId: 8439376,  role: "unit",     access: "owner", hasGateway: false },
  { hostawayId: 184041, address: "37 Smith St U4",           lockId: 9839654,  role: "unit",     access: "owner", hasGateway: false },

  // Ekey properties — secondary admin access.
  // automate:false — surfaced in /locks (Command Center / ue-codes show the lock
  // and its on-lock codes) but EXCLUDED from 8AM code generation. These are
  // offline ekey locks whose guest codes are managed manually via Hostaway
  // custom fields / keypad; auto-generating would overwrite working codes.
  { hostawayId: 478632, address: "394 Quincy St U1",         lockId: 27329140, role: "unit",     access: "ekey",  hasGateway: false, automate: false },
  { hostawayId: 356386, address: "394 Quincy St U2",         lockId: null,     role: "unit",     access: "ekey",  hasGateway: null,  automate: false, lockSystem: "Electronic keypad (unit door); Sifely front entrance only" },
  { hostawayId: 324962, address: "53 Alvord Ave U2",         lockId: 18373930, role: "unit",     access: "ekey",  hasGateway: false, automate: false },
  { hostawayId: 191036, address: "53 Alvord Ave U3",         lockId: 9820068,  role: "unit",     access: "ekey",  hasGateway: false, automate: false },
  { hostawayId: 321066, address: "43 Waumbeck St U2",        lockId: 27282912, role: "unit",     access: "ekey",  hasGateway: false, automate: false },
  { hostawayId: null,   address: "394 Quincy Shared Entrance",lockId: 27822936, role: "entrance", access: "ekey",  hasGateway: false, automate: false },

  // Out of scope — non-Sifely or no automation possible
  { hostawayId: 468028, address: "9 Kenneth Rd",             lockId: null,     role: "unit",     access: "none",  hasGateway: false, lockSystem: "Yale"          },
  { hostawayId: 396709, address: "46 Clewley Rd U1",         lockId: null,     role: "unit",     access: "none",  hasGateway: false, lockSystem: "Yale"          },
  { hostawayId: 485986, address: "3543 Otterbein Ave",       lockId: null,     role: "unit",     access: "none",  hasGateway: false, lockSystem: "Lockbox + Eufy"},
];

// Shared building entrances have hostawayId:null (they belong to no single
// listing). This maps each unit listing → the shared entrance lock(s) it uses.
// Single source of truth: the 8AM automation (orchestrator) AND the read path
// (servesListings below) both consume it, so a unit's lookup shows its own door
// PLUS the building's shared entrance.
export const ENTRANCE_MAP = {
  471403: [27347090], 477004: [27347090], 479570: [27347090], // 48 Quincy U1/U2/U3 → front door
  406539: [23474674], 412479: [23474674], 412478: [23474674], // 246 Broadway U1/U2/Full → entrance
  478632: [27822936], 356386: [27822936],                     // 394 Quincy U1/U2 → front entrance
};

// Reverse of ENTRANCE_MAP: entrance lockId → [unit hostawayIds it serves], so
// enrichLock can tag each shared entrance with the listings it belongs under.
const ENTRANCE_SERVES = (() => {
  const rev = {};
  for (const [listingId, lockIds] of Object.entries(ENTRANCE_MAP)) {
    for (const id of lockIds) (rev[id] ??= []).push(Number(listingId));
  }
  return rev;
})();

// ── Owner locks ───────────────────────────────────────────────────────────────
export async function getAllLocks(token) {
  const owned  = await fetchOwnedLocks(token);
  const ekeys  = await fetchEkeyLocks(token);

  // Merge — ekeys may duplicate owned locks, dedupe by lockId
  const seen = new Set(owned.map(l => l.lockId));
  const merged = [
    ...owned,
    ...ekeys.filter(l => !seen.has(l.lockId)),
  ];

  console.log(`[locks] ${owned.length} owned + ${ekeys.length} ekey = ${merged.length} total (${merged.length - owned.length - ekeys.length + seen.size} deduped)`);
  return merged;
}

async function fetchOwnedLocks(token) {
  const locks = [];
  let pageNo = 1;

  while (true) {
    const params = new URLSearchParams({ pageNo: String(pageNo), pageSize: "100" });
    const res = await fetch(`${BASE_URL}/v3/lock/list?${params}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`[owned locks] HTTP ${res.status}`);
    const data = await res.json();
    if (!data.list?.length) break;
    locks.push(...data.list.map(l => enrichLock(l, "owner")));
    if (data.list.length < 100) break;
    pageNo++;
  }
  return locks;
}

async function fetchEkeyLocks(token) {
  const locks = [];
  let pageNo = 1;

  while (true) {
    const params = new URLSearchParams({ pageNo: String(pageNo), pageSize: "100" });
    const res = await fetch(`${BASE_URL}/v3/key/list?${params}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.warn(`[ekey locks] HTTP ${res.status} — skipping`);
      break;
    }
    const data = await res.json();
    if (!data.list?.length) break;
    locks.push(...data.list.map(l => enrichLock(l, "ekey")));
    if (data.list.length < 100) break;
    pageNo++;
  }
  return locks;
}

function enrichLock(lock, accessType) {
  const hasGateway = lock.hasGateway === 1;

  // Look up in property map
  const mapEntry = PROPERTY_LOCK_MAP.find(p => p.lockId === lock.lockId);

  return {
    lockId:            lock.lockId,
    lockName:          lock.lockName  ?? "(unnamed)",
    lockAlias:         lock.lockAlias ?? "",
    battery:           lock.electricQuantity != null ? `${lock.electricQuantity}%` : "unknown",
    batteryNum:        lock.electricQuantity ?? null,
    hasGateway,
    accessType,                          // "owner" | "ekey"
    automationCapable: hasGateway,
    automationNote:    hasGateway
      ? "Timed API passcodes supported via gateway"
      : "No gateway — offline passcode only",
    hostawayId:        mapEntry?.hostawayId  ?? null,
    propertyAddress:   mapEntry?.address     ?? "unmapped",
    role:              mapEntry?.role        ?? "unknown",  // entrance | unit | back
    servesListings:    ENTRANCE_SERVES[lock.lockId] ?? null, // shared entrances: the unit listings they belong under
    automate:          mapEntry?.automate    ?? true,        // false = manual-managed; skip 8AM generation
    status:            mapEntry ? "active" : "past",
    noKeyPwd:          lock.noKeyPwd ?? null,
    _raw:              lock,
  };
}
