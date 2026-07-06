const BASE_URL = process.env.SIFELY_BASE_URL || "https://app-smart-server.sifely.com";

function generateSixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// End every guest code at 5:00 PM Eastern on the checkout calendar day.
// Hostaway checkOut is usually a bare date (YYYY-MM-DD) which parses to UTC
// midnight, so we anchor on the calendar day and build 17:00 ET explicitly,
// resolving the correct UTC offset (EST -05:00 / EDT -04:00) for that date.
function checkoutDeadlineMs(checkOut) {
  const d = new Date(checkOut);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  // Find America/New_York offset on this date via Intl (handles DST).
  const probe = new Date(`${y}-${m}-${day}T17:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", timeZoneName: "shortOffset",
  }).formatToParts(probe).find(p => p.type === "timeZoneName")?.value || "GMT-5";
  const match = parts.match(/GMT([+-]\d{1,2})/);
  const offsetHrs = match ? parseInt(match[1], 10) : -5;
  const sign = offsetHrs < 0 ? "-" : "+";
  const abs = String(Math.abs(offsetHrs)).padStart(2, "0");
  return new Date(`${y}-${m}-${day}T17:00:00${sign}${abs}:00`).getTime();
}

export async function generatePasscode(token, { lockId, hasGateway, guestLabel, checkIn, checkOut }) {
  if (hasGateway) {
    try {
      const result = await createTimedCode(token, { lockId, guestLabel, checkIn, checkOut });
      return { ...result, strategy: "timed", fallback: false };
    } catch (err) {
      console.warn(`[passcodes] Gateway failed for lock ${lockId}: ${err.message} — falling back to offline`);
      const result = await createOfflineCode(token, { lockId, guestLabel, checkIn, checkOut });
      return { ...result, strategy: "offline", fallback: true, fallbackReason: err.message };
    }
  } else {
    const result = await createOfflineCode(token, { lockId, guestLabel, checkIn, checkOut });
    return { ...result, strategy: "offline", fallback: false };
  }
}

export async function deletePasscode(token, { lockId, pwdId }) {
  const params = new URLSearchParams({ lockId: String(lockId), keyboardPwdId: String(pwdId) });
  const res = await fetch(`${BASE_URL}/v3/keyboardPwd/delete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const data = await res.json();
  if (data.code !== 200) throw new Error(`Delete passcode failed: ${JSON.stringify(data)}`);
  return true;
}

async function createTimedCode(token, { lockId, guestLabel, checkIn, checkOut }) {
  const startDate    = new Date(checkIn).getTime();
  const endDate      = checkoutDeadlineMs(checkOut);
  const keyboardPwd  = generateSixDigitCode();
  const params = new URLSearchParams({
    lockId: String(lockId), keyboardPwdType: "3", keyboardPwdName: guestLabel,
    startDate: String(startDate), endDate: String(endDate),
    addType: "1", keyboardPwd,
  });
  const res = await fetch(`${BASE_URL}/v3/keyboardPwd/add?${params}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.keyboardPwdId) throw new Error(`Timed code failed: ${JSON.stringify(data)}`);
  // addType=1 echoes back null for keyboardPwd — use the one we generated
  return { code: keyboardPwd, pwdId: data.keyboardPwdId };
}

async function createOfflineCode(token, { lockId, guestLabel, checkIn, checkOut }) {
  const startDate = new Date(checkIn).getTime();
  const endDate   = checkoutDeadlineMs(checkOut);
  const params = new URLSearchParams({
    lockId: String(lockId), keyboardPwdType: "2", keyboardPwdName: guestLabel,
    startDate: String(startDate), endDate: String(endDate),
  });
  const res = await fetch(`${BASE_URL}/v3/keyboardPwd/get?${params}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const raw = await res.text();
  console.log(`[passcodes] Offline response for lock ${lockId}: ${raw}`);
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`Non-JSON response: ${raw}`); }
  if (!data.keyboardPwd) throw new Error(`Offline code failed: ${raw}`);
  return { code: data.keyboardPwd, pwdId: data.keyboardPwdId ?? null };
}
