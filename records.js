import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const TABLE = "sifely_passcode_records";

export async function saveRecord(reservationId, record) {
  const row = {
    reservation_id: reservationId,
    hostaway_listing_id: record.hostawayListingId ?? null,
    guest_name: record.guestName ?? null,
    guest_label: record.guestLabel ?? null,
    platform: record.platform ?? null,
    check_in: record.checkIn ?? null,
    check_out: record.checkOut ?? null,
    status: "active",
    record: { ...record, reservationId, createdAt: new Date().toISOString(), status: "active" },
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from(TABLE).upsert(row, { onConflict: "reservation_id" }).select().single();
  if (error) throw new Error(`[records] saveRecord failed: ${error.message}`);
  return data.record;
}

export async function getRecord(reservationId) {
  const { data, error } = await supabase.from(TABLE).select("record").eq("reservation_id", reservationId).maybeSingle();
  if (error) throw new Error(`[records] getRecord failed: ${error.message}`);
  return data?.record ?? null;
}

export async function markDeleted(reservationId) {
  const { data: existing } = await supabase.from(TABLE).select("record").eq("reservation_id", reservationId).maybeSingle();
  if (!existing) return null;
  const updated = { ...existing.record, status: "deleted", deletedAt: new Date().toISOString() };
  const { data, error } = await supabase.from(TABLE)
    .update({ status: "deleted", deleted_at: new Date().toISOString(), record: updated, updated_at: new Date().toISOString() })
    .eq("reservation_id", reservationId).select().single();
  if (error) throw new Error(`[records] markDeleted failed: ${error.message}`);
  return data.record;
}

export async function markFailed(reservationId, err) {
  const { data: existing } = await supabase.from(TABLE).select("record").eq("reservation_id", reservationId).maybeSingle();
  const base = existing?.record ?? { reservationId };
  const updated = { ...base, reservationId, status: "failed", error: err.message ?? String(err), failedAt: new Date().toISOString() };
  const { data, error } = await supabase.from(TABLE)
    .upsert({ reservation_id: reservationId, status: "failed", failed_at: new Date().toISOString(), record: updated, updated_at: new Date().toISOString() }, { onConflict: "reservation_id" })
    .select().single();
  if (error) throw new Error(`[records] markFailed failed: ${error.message}`);
  return data.record;
}

export async function getAllActive() {
  const { data, error } = await supabase.from(TABLE).select("record").eq("status", "active");
  if (error) throw new Error(`[records] getAllActive failed: ${error.message}`);
  return data.map(r => r.record);
}

export async function getAllRecords() {
  const { data, error } = await supabase.from(TABLE).select("record").order("created_at", { ascending: false });
  if (error) throw new Error(`[records] getAllRecords failed: ${error.message}`);
  return data.map(r => r.record);
}
