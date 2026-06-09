const WEBHOOK_URL = process.env.SLACK_LOCK_ALERTS_WEBHOOK;

export async function sendAlert({ level = "warning", property, guestName, platform, checkIn, reservationId, message, locks = [] }) {
  if (!WEBHOOK_URL) { console.warn("[alerts] SLACK_LOCK_ALERTS_WEBHOOK not set — skipping"); return; }
  const emoji = level === "error" ? ":rotating_light:" : ":warning:";
  const title = level === "error" ? "Lock code generation FAILED — manual action required" : "Gateway fallback — offline code used instead";
  const fallbackLocks = locks.filter(l => l.fallback || l.error).map(l => `• ${l.role} (lockId: ${l.lockId}): ${l.fallbackReason ?? l.error}`).join("\n");
  const body = {
    text: `${emoji} *${title}*`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `${emoji} *${title}*` } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*Property*\n${property}` },
        { type: "mrkdwn", text: `*Guest*\n${guestName}` },
        { type: "mrkdwn", text: `*Platform*\n${platform}` },
        { type: "mrkdwn", text: `*Check-in*\n${checkIn}` },
        { type: "mrkdwn", text: `*Reservation ID*\n${reservationId}` },
      ]},
      fallbackLocks ? { type: "section", text: { type: "mrkdwn", text: `*Affected locks:*\n${fallbackLocks}` } } : null,
      message ? { type: "section", text: { type: "mrkdwn", text: `*Details:* ${message}` } } : null,
    ].filter(Boolean),
  };
  try {
    const res = await fetch(WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) console.error(`[alerts] Slack webhook failed: ${res.status}`);
    else console.log(`[alerts] Alert sent (${level}): ${property} / ${guestName}`);
  } catch (err) { console.error(`[alerts] Failed: ${err.message}`); }
}
