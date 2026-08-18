// Echte Kunden-Antwortadresse ermitteln — wichtig bei Kontaktformular-/Relay-Mails
// (z. B. Shopify-Kontaktformular sendet von mailer@shopify.com, Kunde steht im Text/Reply-To).

const RELAY_RE = /(@|\.)shopify\.com$|no-?reply|mailer@|notification|do-?not-?reply/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function isRelayAddress(addr: string | null | undefined): boolean {
  if (!addr) return true;
  return RELAY_RE.test(addr.toLowerCase());
}

/** E-Mail aus einem (Kontaktformular-)Text ziehen; bevorzugt eine mit „E-Mail:"-Label. */
export function emailFromBody(text: string | null | undefined, exclude?: string | null): string | null {
  if (!text) return null;
  const ex = (exclude ?? "").toLowerCase();
  const labeled = text.match(/(?:e-?mail|mail)\s*[:\-–]?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i);
  if (labeled && labeled[1].toLowerCase() !== ex && !isRelayAddress(labeled[1])) return labeled[1].toLowerCase();
  const any = text.match(EMAIL_RE);
  if (any && any[0].toLowerCase() !== ex && !isRelayAddress(any[0])) return any[0].toLowerCase();
  return null;
}

/** Name aus Kontaktformular-Text ("Name: Max Mustermann"). */
export function nameFromBody(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/name\s*[:\-–]\s*(.+)/i);
  if (m) {
    const n = m[1].trim().split(/\r?\n/)[0].trim();
    return n ? n.slice(0, 80) : null;
  }
  return null;
}

/** Beste Kunden-Antwortadresse: Reply-To > E-Mail im Text (bei Relay-Absender) > Absender. */
export function bestCustomerEmail(opts: {
  from: string | null;
  replyTo: string | null;
  bodyText: string | null;
  shopAddress: string | null;
}): string {
  const shop = (opts.shopAddress ?? "").toLowerCase();
  const replyTo = (opts.replyTo ?? "").toLowerCase();
  const from = (opts.from ?? "unknown").toLowerCase();
  if (replyTo && replyTo !== shop && !isRelayAddress(replyTo)) return replyTo;
  if (isRelayAddress(from) || from === shop) {
    const be = emailFromBody(opts.bodyText, shop);
    if (be) return be;
  }
  return from;
}
