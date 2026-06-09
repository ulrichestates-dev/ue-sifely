import fs   from "fs";
import path from "path";

const RECORDS_FILE = path.resolve(process.cwd(), "passcode-records.json");

function readAll() {
  if (!fs.existsSync(RECORDS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(RECORDS_FILE, "utf8")); }
  catch { return {}; }
}

function writeAll(records) {
  fs.writeFileSync(RECORDS_FILE, JSON.stringify(records, null, 2));
}

export function saveRecord(reservationId, record) {
  const all = readAll();
  all[reservationId] = { ...record, reservationId, createdAt: new Date().toISOString(), status: "active" };
  writeAll(all);
  return all[reservationId];
}

export function getRecord(reservationId) {
  return readAll()[reservationId] ?? null;
}

export function markDeleted(reservationId) {
  const all = readAll();
  if (!all[reservationId]) return null;
  all[reservationId].status = "deleted";
  all[reservationId].deletedAt = new Date().toISOString();
  writeAll(all);
  return all[reservationId];
}

export function markFailed(reservationId, error) {
  const all = readAll();
  all[reservationId] = { ...(all[reservationId] ?? {}), reservationId, status: "failed", error: error.message ?? String(error), failedAt: new Date().toISOString() };
  writeAll(all);
  return all[reservationId];
}

export function getAllActive() {
  return Object.values(readAll()).filter(r => r.status === "active");
}

export function getAllRecords() {
  return Object.values(readAll());
}
