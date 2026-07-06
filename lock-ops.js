/**
 * lock-ops.js — Direct per-lock Sifely v3 operations.
 *
 * Operate on a lockId directly, independent of any Hostaway reservation.
 * Verified against live Sifely API (2026-07-06):
 *   READS use GET: /v3/lock/detail, /v3/lock/queryOpenState, /v3/lockRecord/list,
 *     /v3/lock/listKeyboardPwd  (POST returns "method not supported"; the old
 *     /v3/keyboardPwd/list path 404s).
 *   WRITES use POST. Offline timed code = keyboardPwdType 2 (NOT 3). addType 2
 *     (auto-generate) is broken server-side, so we self-supply the code with
 *     addType 1. Timestamps must be real Unix ms (0/blank = "Invalid Parameter").
 * Reads return the raw parsed Sifely response so path issues surface as data.
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

async function req(token, method, path, params, { form = false } = {}) {
  const qs = new URLSearchParams(params);
  const isGet = method === "GET";
  const url = (isGet || !form) ? `${BASE_URL}${path}?${qs}` : `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(form && !isGet ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(form && !isGet ? { body: qs } : {}),
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { return { ok: false, httpStatus: res.status, raw }; }
  return data;
}

const get  = (token, path, params) => req(token, "GET", path, params);
const post = (token, path, params, opts) => req(token, "POST", path, params, opts);

// ---- READ (GET) ----

export async function listLockCodes(token, { lockId, pageNo = 1, pageSize = 100 }) {
  return get(token, "/v3/lock/listKeyboardPwd", {
    lockId: String(lockId),
    pageNo: String(pageNo),
    pageSize: String(pageSize),
    orderBy: "0",
  });
}

export async function lockRecords(token, { lockId, pageNo = 1, pageSize = 50 }) {
  return get(token, "/v3/lockRecord/list", {
    lockId: String(lockId),
    pageNo: String(pageNo),
    pageSize: String(pageSize),
  });
}

export async function lockDetail(token, { lockId }) {
  return get(token, "/v3/lock/detail", { lockId: String(lockId) });
}

export async function queryLockState(token, { lockId }) {
  return get(token, "/v3/lock/queryOpenState", { lockId: String(lockId) });
}

// ---- WRITE: codes (POST) ----

export async function addLockCode(token, { lockId, code, name, startDate, endDate }) {
  const s = toMs(startDate), e = toMs(endDate);
  if (!s || !e) throw new Error("startDate and endDate are required (real dates; 0/blank is rejected by Sifely)");
  const keyboardPwd = code || sixDigit();
  const params = {
    lockId: String(lockId),
    keyboardPwdType: "2",              // 2 = offline timed
    keyboardPwd,
    keyboardPwdName: name || `Manual — ${new Date().toISOString().slice(0, 10)}`,
    addType: "1",                      // 1 = self-supplied code (auto-gen is broken)
    startDate: s,
    endDate: e,
  };
  const data = await post(token, "/v3/keyboardPwd/add", params);
  // Sifely echoes null for the code on custom entries, so return what we sent.
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
    changeType: "2",
  };
  if (newCode) params.newKeyboardPwd = String(newCode);
  const s = toMs(startDate), e = toMs(endDate);
  if (s) params.startDate = s;
  if (e) params.endDate = e;
  return post(token, "/v3/keyboardPwd/change", params);
}

// ---- WRITE: gateway remote ops (gateway locks only, POST) ----

export async function remoteUnlock(token, { lockId }) {
  return post(token, "/v3/lock/unlock", { lockId: String(lockId) });
}

export async function remoteLock(token, { lockId }) {
  return post(token, "/v3/lock/lock", { lockId: String(lockId) });
}
