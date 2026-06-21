// Wochenbericht als E-Mail (HTML + Text) aus dem FullReport.
import type { FullReport } from "@/server/reports";

function trend(cur: number, prev: number): string {
  const d = cur - prev;
  if (d === 0) return "±0";
  return d > 0 ? `▲ +${d}` : `▼ ${d}`;
}

function fmtMin(m: number | null): string {
  if (m === null) return "—";
  return m >= 120 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`;
}
function fmtHours(h: number | null): string {
  if (h === null) return "—";
  return h >= 48 ? `${(h / 24).toFixed(1)} Tage` : `${h} h`;
}

export function buildWeeklyEmail(
  shopName: string,
  appUrl: string,
  r: FullReport,
): { subject: string; text: string; html: string } {
  const subject = `Wochenbericht ${shopName} — ${r.inbound} Anfragen${r.warnings.length ? `, ${r.warnings.length} Warnung(en)` : ""}`;

  // ---- Text ----
  const draftTotal = r.draftOutcomes.verbatim + r.draftOutcomes.edited + r.draftOutcomes.manual;
  const tl: string[] = [];
  tl.push(`Wochenbericht ${shopName} (letzte ${r.days} Tage)`);
  tl.push("");
  if (r.warnings.length) {
    tl.push("⚠️ FRÜHWARNUNGEN");
    for (const w of r.warnings) tl.push(`- ${w.title} — ${w.detail}`);
    tl.push("");
  }
  tl.push("VOLUMEN & LAST");
  tl.push(`- Mails rein: ${r.inbound} (${trend(r.inbound, r.inboundPrev)})`);
  tl.push(`- Neue Tickets: ${r.newTickets} (${trend(r.newTickets, r.newTicketsPrev)}), davon wieder-offen: ${r.reopened}`);
  tl.push(`- Antworten: ${r.replies} · Kunden: ${r.uniqueCustomers} · Ø Nachr./Ticket: ${r.avgMsgsPerTicket}`);
  tl.push(`- Eskalationen: ${r.escalations} (${trend(r.escalations, r.escalationsPrev)})`);
  tl.push("");
  if (r.byCategory.length) {
    tl.push("TOP-THEMEN");
    for (const c of r.byCategory.slice(0, 6)) tl.push(`- ${c.category}: ${c.n} (${trend(c.n, c.prev)})`);
    tl.push("");
  }
  if (r.byProduct.length) {
    tl.push("PRODUKT-HOTSPOTS");
    for (const p of r.byProduct.slice(0, 5)) tl.push(`- ${p.product}: ${p.n}`);
    tl.push("");
  }
  tl.push("EFFIZIENZ");
  tl.push(`- Ø erste Antwort: ${fmtMin(r.avgFirstResponseMin)} · Ø Lösungszeit: ${fmtHours(r.avgResolutionHours)}`);
  tl.push(`- 1. Anlauf gelöst: ${r.fcrRate === null ? "—" : Math.round(r.fcrRate * 100) + " %"} · Rückstau >48h: ${r.backlogAging}`);
  tl.push(`- Stimmung: 😊 ${r.sentiment.positiv} / 😐 ${r.sentiment.neutral} / 😠 ${r.sentiment.negativ}`);
  if (r.returns.total > 0) {
    tl.push(`- Retouren: ${r.returns.total} Anfragen, ${r.returns.deflected} behalten, ${(r.returns.recoveredCents / 100).toFixed(2)} € zurückgewonnen`);
  }
  if (draftTotal) {
    const pct = (n: number) => Math.round((n / draftTotal) * 100);
    tl.push(`- KI-Entwürfe: 1:1 ${pct(r.draftOutcomes.verbatim)} % / bearbeitet ${pct(r.draftOutcomes.edited)} % / ohne ${pct(r.draftOutcomes.manual)} %`);
  }
  tl.push("");
  tl.push(`Vollständige Auswertung: ${appUrl}/reports`);
  const text = tl.join("\n");

  // ---- HTML ----
  const card = (inner: string) =>
    `<div style="border:1px solid #e7e9ee;border-radius:10px;padding:14px 16px;margin:0 0 14px">${inner}</div>`;
  const h2 = (t: string) => `<div style="font-weight:700;font-size:15px;margin:0 0 8px">${t}</div>`;
  const row = (k: string, v: string) =>
    `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:14px"><span style="color:#5b616e">${k}</span><span style="font-weight:600">${v}</span></div>`;

  let warnHtml = "";
  if (r.warnings.length) {
    warnHtml =
      `<div style="border:1px solid #e5634d55;background:#e5634d11;border-radius:10px;padding:14px 16px;margin:0 0 14px">` +
      h2("⚠️ Frühwarnungen") +
      r.warnings
        .map((w) => `<div style="font-size:14px;margin:4px 0"><b>${w.title}</b><br><span style="color:#5b616e">${w.detail}</span></div>`)
        .join("") +
      `</div>`;
  }

  const catHtml = r.byCategory.length
    ? card(
        h2("Top-Themen") +
          r.byCategory.slice(0, 6).map((c) => row(c.category, `${c.n} (${trend(c.n, c.prev)})`)).join(""),
      )
    : "";
  const prodHtml = r.byProduct.length
    ? card(h2("Produkt-Hotspots") + r.byProduct.slice(0, 5).map((p) => row(p.product, String(p.n))).join(""))
    : "";

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:620px;margin:0 auto;color:#1a1d24">` +
    `<h1 style="font-size:20px;margin:0 0 4px">Wochenbericht ${shopName}</h1>` +
    `<div style="color:#5b616e;font-size:13px;margin:0 0 16px">Letzte ${r.days} Tage</div>` +
    warnHtml +
    card(
      h2("Volumen & Last") +
        row("Mails rein", `${r.inbound} (${trend(r.inbound, r.inboundPrev)})`) +
        row("Neue Tickets", `${r.newTickets} (${trend(r.newTickets, r.newTicketsPrev)})`) +
        row("davon wieder-offen", String(r.reopened)) +
        row("Antworten", String(r.replies)) +
        row("Kunden", String(r.uniqueCustomers)) +
        row("Ø Nachrichten/Ticket", String(r.avgMsgsPerTicket)) +
        row("Eskalationen", `${r.escalations} (${trend(r.escalations, r.escalationsPrev)})`),
    ) +
    catHtml +
    prodHtml +
    card(
      h2("Effizienz & Stimmung") +
        row("Ø erste Antwort", fmtMin(r.avgFirstResponseMin)) +
        row("Ø Lösungszeit", fmtHours(r.avgResolutionHours)) +
        row("Im 1. Anlauf gelöst", r.fcrRate === null ? "—" : `${Math.round(r.fcrRate * 100)} %`) +
        row("Rückstau (>48 h)", String(r.backlogAging)) +
        row("Stimmung", `😊 ${r.sentiment.positiv} / 😐 ${r.sentiment.neutral} / 😠 ${r.sentiment.negativ}`) +
        (r.returns.total > 0
          ? row("Retouren zurückgewonnen", `${(r.returns.recoveredCents / 100).toFixed(2)} € (${r.returns.deflected}/${r.returns.total})`)
          : ""),
    ) +
    `<a href="${appUrl}/reports" style="display:inline-block;background:#2b6ef2;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">Vollständige Auswertung öffnen</a>` +
    `</div>`;

  return { subject, text, html };
}
