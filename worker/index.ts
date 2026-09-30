// Mail-Worker: holt eingehende Mails (IMAP) und sendet freigegebene Antworten (SMTP).
//   npm run worker        -> Dauerschleife (POLL_INTERVAL_SECONDS)
//   npm run worker:once   -> ein Zyklus, dann Ende (z. B. zum Testen / Cron)
import "dotenv/config";
import cron from "node-cron";
import { sql } from "drizzle-orm";
import { db } from "../src/server/db/index";
import { ingestAll } from "./imap";
import { processOutbox } from "./smtp";
import { runWeeklyReports } from "./reports";
import { triageRecent } from "../src/server/ai/triage";
import { autoDraftRecent } from "../src/server/ai/autodraft";
import { autoLinkOrders } from "../src/server/ai/autolink";
import { learnFromEdits } from "../src/server/ai/learn";
import { autoCloseAnswered } from "../src/server/auto-close";
import { syncAllPaypal } from "../src/server/paypal-disputes";

// Anhänge (Fotos) automatisch begrenzen: alte löschen, damit die DB nicht vollläuft. Höchstens 1×/Std.
const KEEP_DAYS = Number(process.env.ATTACHMENT_KEEP_DAYS ?? 30);
let lastPrune = 0;
async function pruneOldAttachments() {
  if (Date.now() - lastPrune < 3_600_000) return; // max. stündlich
  lastPrune = Date.now();
  try {
    const r: any = await db.execute(
      sql`DELETE FROM message_attachment WHERE created_at < now() - make_interval(days => ${KEEP_DAYS})`,
    );
    const n = r?.rowCount ?? 0;
    if (n) console.log(`[worker] ${n} alte Anhänge (>${KEEP_DAYS} Tage) gelöscht.`);
  } catch (e) {
    console.error("[worker] Anhang-Prune-Fehler:", e instanceof Error ? e.message : e);
  }
}

// Überlappungs-Schutz: dauert ein Zyklus länger als das Intervall (viele Mails, KI-Entwürfe),
// startet der nächste NICHT parallel — sonst drohen doppelte Tickets/Entwürfe.
let cycleRunning = false;

async function runCycle() {
  if (cycleRunning) {
    console.log("[worker] Vorheriger Zyklus läuft noch — übersprungen.");
    return;
  }
  cycleRunning = true;
  try {
    // Erst senden (Ausgang hat Vorrang) — dann abholen + Ordner spiegeln (kann bei vielen Mails dauern).
    const sent = await processOutbox();
    const fetched = await ingestAll();
    await pruneOldAttachments();
    // Bestell-Abgleich zu jeder neuen Kundenmail (vor dem Entwurf, damit die Zuordnung gespeichert ist).
    try {
      await autoLinkOrders();
    } catch (e) {
      console.error("[worker] Bestell-Abgleich-Fehler:", e instanceof Error ? e.message : e);
    }
    // Anliegen-Erkennung bei jeder neuen Kundenmail (nach dem Abgleich -> kennt die Bestellartikel).
    let tagged = 0;
    try {
      tagged = await triageRecent();
    } catch (e) {
      console.error("[worker] Anliegen-Erkennung-Fehler:", e instanceof Error ? e.message : e);
    }
    // KI-Entwurf zu jeder neuen Kundenmail (nur Entwurf — gesendet wird nach menschlicher Freigabe).
    let drafted = 0;
    try {
      drafted = await autoDraftRecent();
    } catch (e) {
      console.error("[worker] Auto-Entwurf-Fehler:", e instanceof Error ? e.message : e);
    }
    // PayPal-Käuferschutzfälle abrufen (je Shop höchstens alle 30 Min.)
    try {
      await syncAllPaypal();
    } catch (e) {
      console.error("[worker] PayPal-Fehler:", e instanceof Error ? e.message : e);
    }
    // Beantwortete Tickets nach 5 Tagen ohne Kundenantwort automatisch abhaken.
    try {
      const closed = await autoCloseAnswered();
      if (closed) console.log(`[worker] ${closed} beantwortete Ticket(s) automatisch gelöst.`);
    } catch (e) {
      console.error("[worker] Auto-Abhaken-Fehler:", e instanceof Error ? e.message : e);
    }
    // Lern-Loop: aus geänderten Entwürfen Regel-Vorschläge ableiten (Freigabe im KI-Gehirn).
    try {
      await learnFromEdits();
    } catch (e) {
      console.error("[worker] Lern-Fehler:", e instanceof Error ? e.message : e);
    }
    console.log(
      `[${new Date().toISOString()}] ${fetched} Mail(s) abgeholt, ${sent} gesendet, ${tagged} eingeordnet, ${drafted} Entwürfe.`,
    );
  } catch (err) {
    console.error("[worker] Zyklus-Fehler:", err);
  } finally {
    cycleRunning = false;
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
