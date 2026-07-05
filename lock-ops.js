/**
 * lock-ops.js — Direct per-lock Sifely v3 operations.
 *
 * These operate on a lockId directly, independent of any Hostaway reservation.
 * Confirmed endpoints (from passcodes.js): /v3/keyboardPwd/{add,get,delete}
 * Inferred from the TTLock/Sciener v3 platform Sifely white-labels:
 *   /v3/keyboardPwd/list, /v3/keyboardPwd/change, /v3/lockRecord/list,
 *   /v3/lock/detail, /v3/lock/queryOpenState, /v3/lock/unlock, /v3/lock/lock
 * All calls return the raw parsed Sifely response so wrong paths surface as
 * data (code/errcode/description) instead of throwing.
 */

const BASE_URL = process.env.SIFELY_BASE_URL || "https://app-smart-server.sifely.com";

// Accept ISO strings, ms numbers, or ms strings — return ms string.
function toMs(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return String(v);
  if (/^\d{10,}$/.test(String(v))) return String(v);
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) throw new Error(`Invalid date: ${v}`);
  return String(t);
}

function sixDigit() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function post(token, path, params, { form = false } = {}) {
  const qs = new URLSearchParams(params);
  const url = form ? `${BASE_URL}${path}` : `${BASE_URL}${path}?${qs}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(form ? { body: qs } : {}),
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { return { ok: false, httpStatus: res.status, raw }; }
  return data;
}

// ---- READ ----

export async function listLockCodes(token, { lockId, pageNo = 1, pageSize = 100 }) {
  return post(token, "/v3/keyboardPwd/list", {
    lockId: String(lockId),
    pageNo: String(pageNo),
    pageSize: String(pageSize),
    orderBy: "0",
  });
}

export async function lockRecords(token, { lockId, pageNo = 1, pageSize = 50 }) {
  return post(token, "/v3/lockRecord/list", {
    lockId: String(lockId),
    pageNo: String(pageNo),
    pageSize: String(pageSize),
  });
}

export async function lockDetail(token, { lockId }) {
  return post(token, "/v3/lock/detail", { lockId: String(lockId) });
}

export async function queryLockState(token, { lockId }) {
  return post(token, "/v3/lock/queryOpenState", { lockId: String(lockId) });
}

// ---- WRITE: codes ----

export async function addLockCode(token, { lockId, code, name, startDate, endDate }) {
  const keyboardPwd = code || sixDigit();
  const params = {
    lockId: String(lockId),
    keyboardPwdType: "3",              // 3 = period (start/end)
    keyboardPwd,
    keyboardPwdName: name || `Manual — ${new Date().toISOString().slice(0, 10)}`,
    addType: "2",                      // 2 = via gateway/cloud where available
  };
  const s = toMs(startDate), e = toMs(endDate);
  if (s) params.startDate = s;
  if (e) params.endDate = e;
  const data = await post(token, "/v3/keyboardPwd/add", params);
  return { requestedCode: keyboardPwd, response: data };
}

export async function deleteLockCode(token, { lockId, keyboardPwdId }) {
  return post(token, "/v3/keyboardPwd/delete", {
    lockId: String(lockId),
    keyboardPwdId: String(keyboardPwdId),
  }, { form: true });
}

export async function changeLockCode(token, { lockId, keyboardPwdId, newCode, startDate, endDate }) {
  const params = {
    lockId: String(lockId),
    keyboardPwdId: String(keyboardPwdId),
    changeType: "2",                   // 2 = via gateway/cloud
  };
  if (newCode) params.newKeyboardPwd = String(newCode);
  const s = toMs(startDate), e = toMs(endDate);
  if (s) params.startDate = s;
  if (e) params.endDate = e;
  return post(token, "/v3/keyboardPwd/change", params);
}

// ---- WRITE: gateway remote ops (gateway locks only) ----

export async function remoteUnlock(token, { lockId }) {
  return post(token, "/v3/lock/unlock", { lockId: String(lockId) });
}

export async function remoteLock(token, { lockId }) {
  return post(token, "/v3/lock/lock", { lockId: String(lockId) });
}
