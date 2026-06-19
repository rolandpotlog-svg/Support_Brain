// Reason-Code-Wissen + Heuristiken fürs Dispute-Management. Reine Logik (Client+Server).
// Die KI-Begründung kommt in Phase B; hier deterministische Vorlagen + Faustregeln.

export const ACCEPT_THRESHOLD_EUR = 15; // unter diesem Betrag eher akzeptieren als kämpfen

export type WinChance = "hoch" | "mittel" | "gering";
export type ReasonInfo = { label: string; chance: WinChance; focus: string };

export const REASONS: Record<string, ReasonInfo> = {
  FRAUDULENT: {
    label: "Betrug (unautorisiert)",
    chance: "mittel",
    focus: "Lieferung an die verifizierte Käuferadresse nachweisen (Tracking, ggf. AVS/IP).",
  },
  PRODUCT_NOT_RECEIVED: {
    label: "Ware nicht erhalten",
    chance: "hoch",
    focus: "Liefernachweis: Tracking mit Zustellbeleg an die Bestelladresse.",
  },
  PRODUCT_UNACCEPTABLE: {
    label: "Ware mangelhaft / nicht wie beschrieben",
    chance: "mittel",
    focus: "Produktbeschreibung, Fotos und Reklamations-/Retourenverlauf beilegen.",
  },
  CREDIT_NOT_PROCESSED: {
    label: "Erstattung nicht verarbeitet",
    chance: "gering",
    focus: "Nachweis, dass bereits erstattet wurde — sonst eher akzeptieren.",
  },
  DUPLICATE: {
    label: "Doppelbelastung",
    chance: "mittel",
    focus: "Zwei getrennte Bestellungen/Leistungen belegen.",
  },
  SUBSCRIPTION_CANCELLED: {
    label: "Abo gekündigt",
    chance: "mittel",
    focus: "Kündigungs-/Nutzungsnachweis und AGB zur Kündigung beilegen.",
  },
  UNRECOGNIZED: {
    label: "Belastung nicht erkannt",
    chance: "mittel",
    focus: "Bestellbestätigung, Kommunikation und Lieferung an den Käufer nachweisen.",
  },
  GENERAL: {
    label: "Allgemein",
    chance: "mittel",
    focus: "Alle verfügbaren Nachweise (Bestellung, Lieferung, Kommunikation).",
  },
};

export function reasonInfo(reason?: string | null): ReasonInfo {
  return (
    (reason && REASONS[reason]) || {
      label: reason || "Unbekannt",
      chance: "mittel",
      focus: "Bestellung, Lieferung und Kommunikation beilegen.",
    }
  );
}

const STATUS_LABEL: Record<string, string> = {
  NEEDS_RESPONSE: "Antwort nötig",
  UNDER_REVIEW: "In Prüfung",
  WON: "Gewonnen",
  LOST: "Verloren",
  ACCEPTED: "Akzeptiert",
  CHARGE_REFUNDED: "Erstattet",
};
export function statusLabel(s?: string | null): string {
  if (!s) return "—";
  return STATUS_LABEL[s.toUpperCase()] ?? s;
}

export type Urgency = "none" | "ok" | "soon" | "urgent" | "overdue";

/** Frist-Ampel: overdue (rot), <24 h urgent (rot), <72 h soon (gelb), sonst ok (grün). */
export function urgency(dueBy: Date | null, nowMs: number): { level: Urgency; hoursLeft: number | null } {
  if (!dueBy) return { level: "none", hoursLeft: null };
  const hoursLeft = (dueBy.getTime() - nowMs) / 3_600_000;
  if (hoursLeft < 0) return { level: "overdue", hoursLeft };
  if (hoursLeft < 24) return { level: "urgent", hoursLeft };
  if (hoursLeft < 72) return { level: "soon", hoursLeft };
  return { level: "ok", hoursLeft };
}

export function countdownLabel(hoursLeft: number | null): string {
  if (hoursLeft == null) return "keine Frist";
  if (hoursLeft < 0) return `${Math.abs(Math.round(hoursLeft))} h überfällig`;
  if (hoursLeft < 48) return `${Math.round(hoursLeft)} h übrig`;
  return `${Math.round(hoursLeft / 24)} Tage übrig`;
}

/** Kämpfen vs. akzeptieren — Kosten/Nutzen. Der Mensch entscheidet endgültig. */
export function suggestDecision(
  amount: number,
  reason?: string | null,
): { suggest: "accept" | "fight"; why: string } {
  if (amount > 0 && amount < ACCEPT_THRESHOLD_EUR) {
    return {
      suggest: "accept",
      why: `Kleinbetrag (< ${ACCEPT_THRESHOLD_EUR} €): Gebühr + Aufwand lohnen das Kämpfen meist nicht.`,
    };
  }
  const info = reasonInfo(reason);
  if (info.chance === "gering") {
    return { suggest: "accept", why: `Grund „${info.label}" ist erfahrungsgemäß schwer zu gewinnen.` };
  }
  return { suggest: "fight", why: `Grund „${info.label}" — gute Chance mit den passenden Nachweisen.` };
}

export type EvidenceCtx = {
  orderName?: string | null;
  customerName?: string | null;
  tracking?: string | null;
  carrier?: string | null;
  supportSummary?: string | null;
};

/** Deterministischer Begründungs-Entwurf (uncategorizedText). Phase B: Claude verfeinert ihn. */
export function evidenceTemplate(reason: string | null | undefined, ctx: EvidenceCtx): string {
  const order = ctx.orderName ? `Bestellung ${ctx.orderName}` : "die betreffende Bestellung";
  const lines: string[] = [];
  lines.push(
    `Wir widersprechen diesem Dispute. Der Kauf (${order}) wurde rechtmäßig getätigt und ordnungsgemäß abgewickelt.`,
  );
  if (ctx.tracking) {
    lines.push(
      `Die Ware wurde nachweislich versendet${ctx.carrier ? ` (${ctx.carrier})` : ""}, Sendungsnummer ${ctx.tracking}, an die in der Bestellung angegebene Adresse.`,
    );
  }
  const info = reasonInfo(reason);
  lines.push(`Schwerpunkt für diesen Grund („${info.label}"): ${info.focus}`);
  if (ctx.supportSummary) {
    lines.push(`Kundenkommunikation: ${ctx.supportSummary}`);
  }
  lines.push("Wir bitten daher, den Dispute zugunsten des Händlers zu entscheiden.");
  return lines.join("\n\n");
}
