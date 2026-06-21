// Mail-Worker: holt eingehende Mails (IMAP) und sendet freigegebene Antworten (SMTP).
//   npm run worker        -> Dauerschleife (POLL_INTERVAL_SECONDS)
//   npm run worker:once   -> ein Zyklus, dann Ende (z. B. zum Testen / Cron)
import "dotenv/config";
import cron from "node-cron";
import { ingestAll } from "./imap";
import { processOutbox } from "./smtp";
import { runWeeklyReports } from "./reports";

async function runCycle() {
  try {
    const fetched = await ingestAll();
    const sent = await processOutbox();
    console.log(
      `[${new Date().toISOString()}] ${fetched} Mail(s) abgeholt, ${sent} gesendet.`,
    );
  } catch (err) {
    console.error("[worker] Zyklus-Fehler:", err);
  }
}

async function main() {
  if (process.argv.includes("--weekly")) {
    // Wochenbericht einmal sofort senden (Test): npm run worker -- --weekly
    await runWeeklyReports();
    process.exit(0);
  }
  if (process.argv.includes("--once")) {
    await runCycle();
    process.exit(0);
  }

  const intervalSec = Number(process.env.POLL_INTERVAL_SECONDS ?? 60);
  console.log(`[worker] Start. Intervall ${intervalSec}s. Strg+C zum Beenden.`);
  await runCycle();
  // node-cron braucht ein Sekunden-/Minuten-Pattern; wir bauen es aus dem Intervall.
  const pattern = intervalSec < 60 ? `*/${Math.max(1, intervalSec)} * * * * *` : `*/${Math.round(intervalSec / 60)} * * * *`;
  cron.schedule(pattern, runCycle);
  // Wochenbericht: jeden Montag 07:00 (Serverzeit).
  cron.schedule("0 7 * * 1", runWeeklyReports);
  console.log("[worker] Wochenbericht geplant: Montags 07:00.");
}

main();
