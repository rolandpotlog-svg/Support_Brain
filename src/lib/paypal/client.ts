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
    const msg = j.message ?? j.name ?? `HTTP ${res.status}`;
    throw new Error(res.status === 403 ? `PayPal: keine Berechtigung für Disputes (${msg}) — in der PayPal-App „Disputes“ aktivieren` : `PayPal: ${msg}`);
  }
  return j as T;
}

/** Alle Fälle seit `sinceIso` (durchpaginiert, max. 500). */
export async function listPaypalDisputes(c: PaypalCreds, token: string, sinceIso: string): Promise<PaypalDisputeSummary[]> {
  const out: PaypalDisputeSummary[] = [];
  let next: string | null = `/v1/customer/disputes?page_size=50&start_time=${encodeURIComponent(sinceIso)}`;
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
