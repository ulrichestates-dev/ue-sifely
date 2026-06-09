import express from "express";
import { deleteCodesForBooking, refreshCodesForBooking } from "./orchestrator.js";

export const webhookRouter = express.Router();

webhookRouter.post("/hostaway", async (req, res) => {
  const { event, data } = req.body;
  if (!event || !data) return res.status(400).json({ error: "Missing event or data" });
  console.log(`[webhook] Received event: ${event}`);
  try {
    switch (event) {
      case "reservation.created":
        console.log(`[webhook] reservation.created for ${data.id} — queued for 8 AM scheduler`);
        res.json({ received: true, action: "queued_for_scheduler" });
        break;
      case "reservation.modified": {
        const result = await refreshCodesForBooking(mapReservation(data));
        res.json({ received: true, action: "refreshed", result });
        break;
      }
      case "reservation.cancelled": {
        const result = await deleteCodesForBooking(String(data.id));
        res.json({ received: true, action: "deleted", result });
        break;
      }
      default:
        res.json({ received: true, action: "ignored" });
    }
  } catch (err) {
    console.error(`[webhook] Error handling ${event}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

function mapReservation(r) {
  return {
    hostawayReservationId: String(r.id),
    hostawayListingId:     r.listingMapId,
    guestFirstName:        r.guestName?.split(" ")[0] ?? "Guest",
    guestLastName:         r.guestName?.split(" ").slice(1).join(" ") ?? r.guestName ?? "Guest",
    platform:              r.channelName ?? "direct",
    checkIn:               r.arrivalDate,
    checkOut:              r.departureDate,
  };
}
