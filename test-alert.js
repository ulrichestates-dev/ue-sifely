import "dotenv/config";
import { sendAlert } from "./alerts.js";

await sendAlert({
  level: "warning",
  property: "14 Kenneth Rd",
  guestName: "Test Guest",
  platform: "airbnb",
  checkIn: "2026-06-09",
  reservationId: "TEST-001",
  message: "Test alert from ue-sifely"
});

console.log("Done");
