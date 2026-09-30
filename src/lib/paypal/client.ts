// PayPal REST (Customer Disputes v1): Token holen, Fälle listen, Details lesen.
// Nur LESEN in diesem Schritt — Einreichen/Nachrichten kommen separat (mit Sandbox-Test).
// Felder defensiv lesen: PayPal liefert je nach Fall/Version leicht unterschiedliche Strukturen.

export type PaypalCreds = { clientId: string; clientSecret: string; mode: "sandbox" | "live" };
export type PaypalMoney = { currency_code: string; value: string };

export type PaypalDisputeSummary = {
  dispute_id: string;
  create_time: string;
  update_time: string;
  reason: string;
  status: string;
  dispute_state?: string;
  dispute_life_cycle_stage?: string;
  dispute_amount?: PaypalMoney;
};

export type PaypalTransaction = {
  sellerTransactionId: string | null;
  buyerTransactionId: string | null;
  invoiceNumber: string | null;
  custom: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  amount: PaypalMoney | null;
  createTime: string | null;
};

export type PaypalDisputeDetail = PaypalDisputeSummary & {
  seller_response_due_date?: string;
  buyer_response_due_date?: string;
  dispute_channel?: string;
  transactions: PaypalTransaction[];
  messages: { postedBy: string; time: string; content: string }[];
  outcome?: { outcome_code?: string; amount_refunded?: PaypalMoney };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any;
};

export function paypalBase(mode: "sandbox" | "live"): string {
  return mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

/** Access-Token (Client-Credentials). Wirft mit verständlicher Meldung. */
export async function paypalToken(c: PaypalCreds): Promise<{ token: string; expiresIn: number }> {
  const res = await fetch(`${paypalBase(c.mode)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || typeof j.access_token !== "string") {
    throw new Error(`PayPal-Anmeldung fehlgeschlagen (${res.status}): ${j.error_description ?? j.error ?? "Client-ID/Secret prüfen"}`);
  }
  return { token: j.access_token, expiresIn: Number(j.expires_in) || 3000 };
}

async function pget<T>(c: PaypalCreds, token: string, pathOrUrl: string): Promise<T> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${paypalBase(c.mode)}${pathOrUrl}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detail = (j.details ?? []).map((d: any) => [d.field, d.issue, d.description].filter(Boolean).join(": ")).join("; ");
    const msg = `${j.message ?? j.name ?? `HTTP ${res.status}`}${detail ? ` (${detail})` : ""}`;
    throw new Error(res.status === 403 ? `PayPal: keine Berechtigung für Disputes (${msg}) — in der PayPal-App „Disputes“ aktivieren` : `PayPal: ${msg}`);
  }
  return j as T;
}

/** Alle Fälle seit `sinceIso` (durchpaginiert, max. 500). */
export async function listPaypalDisputes(c: PaypalCreds, token: string, sinceIso: string): Promise<PaypalDisputeSummary[]> {
  const out: PaypalDisputeSummary[] = [];
  // PayPal will start_time als yyyy-MM-ddTHH:mm:ss.SSSZ und max. 180 Tage zurück; lehnt es den
  // Filter trotzdem ab (400), einmal ohne Zeitfilter holen (liefert dann die neuesten Fälle).
  let next: string | null = `/v1/customer/disputes?page_size=50&start_time=${encodeURIComponent(sinceIso)}`;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first: any = await pget(c, token, next);
    for (const d of first.items ?? []) out.push(d);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    next = (first.links ?? []).find((l: any) => l.rel === "next")?.href ?? null;
  } catch (e) {
    if (!(e instanceof Error) || !/well-formed|INVALID_REQUEST|schema/i.test(e.message)) throw e;
    next = `/v1/customer/disputes?page_size=50`;
  }
  for (let guard = 0; next && guard < 10; guard++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = await pget(c, token, next);
    for (const d of j.items ?? []) out.push(d);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    next = (j.links ?? []).find((l: any) => l.rel === "next")?.href ?? null;
  }
  return out;
}

/** Details eines Falls, normalisiert. */
export async function getPaypalDispute(c: PaypalCreds, token: string, id: string): Promise<PaypalDisputeDetail> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = await pget(c, token, `/v1/customer/disputes/${encodeURIComponent(id)}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transactions: PaypalTransaction[] = (d.disputed_transactions ?? []).map((t: any) => ({
    sellerTransactionId: t.seller_transaction_id ?? null,
    buyerTransactionId: t.buyer_transaction_id ?? null,
    invoiceNumber: t.invoice_number ?? null,
    custom: t.custom ?? null,
    buyerName: t.buyer?.name ?? t.buyer_name ?? null,
    buyerEmail: t.buyer?.email ?? t.buyer?.email_address ?? t.buyer_email ?? null,
    amount: t.gross_amount ?? null,
    createTime: t.create_time ?? null,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages = (d.messages ?? []).map((m: any) => ({ postedBy: m.posted_by ?? "?", time: m.time_posted ?? "", content: m.content ?? "" }));
  return { ...d, transactions, messages, raw: d };
}

// ───────────────────────── Schreiben (Schritt 2) ─────────────────────────
// Jede Aktion geht direkt an PayPal. Welche erlaubt ist, sagt PayPal pro Fall über `links` (rel).

/** Aktionen, die PayPal für diesen Fall gerade zulässt (z. B. send_message, make_offer, accept_claim, provide_evidence). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function allowedActions(raw: any): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (raw?.links ?? []).map((l: any) => String(l.rel ?? "")).filter((r: string) => r && r !== "self");
}

async function ppost(c: PaypalCreds, token: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${paypalBase(c.mode)}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readResult(res);
}

/** provide-evidence u. a. verlangen multipart/form-data mit JSON-Teil „input“. */
async function ppostMultipart(c: PaypalCreds, token: string, path: string, input: unknown): Promise<unknown> {
  const fd = new FormData();
  fd.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }), "input.json");
  const res = await fetch(`${paypalBase(c.mode)}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  return readResult(res);
}

async function readResult(res: Response): Promise<unknown> {
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detail = (j.details ?? []).map((d: any) => [d.field, d.issue, d.description].filter(Boolean).join(": ")).join("; ");
    throw new Error(`PayPal: ${j.message ?? j.name ?? `HTTP ${res.status}`}${detail ? ` (${detail})` : ""}`);
  }
  return j;
}

const disputePath = (id: string, action: string) => `/v1/customer/disputes/${encodeURIComponent(id)}/${action}`;

export function sendPaypalMessage(c: PaypalCreds, token: string, id: string, message: string) {
  return ppost(c, token, disputePath(id, "send-message"), { message });
}

/** Angebot an den Käufer (nur Phase Anfrage): Erstattung (auch Teil), Ersatz ohne Erstattung usw. */
export function makePaypalOffer(
  c: PaypalCreds,
  token: string,
  id: string,
  o: { note: string; type: "REFUND" | "REFUND_WITH_RETURN" | "REFUND_WITH_REPLACEMENT" | "REPLACEMENT_WITHOUT_REFUND"; amount?: PaypalMoney },
) {
  return ppost(c, token, disputePath(id, "make-offer"), {
    note: o.note,
    offer_type: o.type,
    ...(o.amount ? { offer_amount: o.amount } : {}),
  });
}

/** Fall annehmen = Käufer bekommt den Betrag zurück, Fall ist erledigt. */
export function acceptPaypalClaim(c: PaypalCreds, token: string, id: string, o: { note: string; amount?: PaypalMoney }) {
  return ppost(c, token, disputePath(id, "accept-claim"), {
    note: o.note,
    accept_claim_type: "REFUND",
    ...(o.amount ? { refund_amount: o.amount } : {}),
  });
}

/** Shopify-Versanddienst -> PayPal-Carrier. Unsichere Namen als OTHER + Klartext (PayPal akzeptiert das). */
export function paypalCarrier(company: string | null): { carrier_name: string; carrier_name_other?: string } {
  const c = (company ?? "").toLowerCase();
  if (/dhl express/.test(c)) return { carrier_name: "DHL" };
  if (/dhl|deutsche post/.test(c)) return { carrier_name: "DHL_DEUTSCHE_POST" };
  if (/\bdpd\b/.test(c)) return { carrier_name: "DPD" };
  if (/\bups\b/.test(c)) return { carrier_name: "UPS" };
  if (/\bgls\b/.test(c)) return { carrier_name: "GLS" };
  return { carrier_name: "OTHER", carrier_name_other: company?.trim() || "Paketdienst" };
}

/** Nachweise einreichen: Tracking (Liefernachweis) und/oder Stellungnahme als Notiz. */
export function providePaypalEvidence(
  c: PaypalCreds,
  token: string,
  id: string,
  o: { notes: string; tracking?: { company: string | null; number: string }[] },
) {
  const evidences = o.tracking?.length
    ? [
        {
          evidence_type: "PROOF_OF_FULFILLMENT",
          evidence_info: { tracking_info: o.tracking.map((t) => ({ ...paypalCarrier(t.company), tracking_number: t.number })) },
          notes: o.notes,
        },
      ]
    : [{ evidence_type: "OTHER", notes: o.notes }];
  return ppostMultipart(c, token, disputePath(id, "provide-evidence"), { evidences });
}
