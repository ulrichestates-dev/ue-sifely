const BASE_URL = process.env.SIFELY_BASE_URL || "https://app-smart-server.sifely.com";

function generateSixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
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
  const endDate      = new Date(checkOut).getTime() + 2 * 60 * 60 * 1000;
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
  const endDate   = new Date(checkOut).getTime() + 2 * 60 * 60 * 1000;
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
