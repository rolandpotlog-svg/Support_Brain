// Meta Graph API: Nachrichten senden + Webhook-Signatur prüfen.
// Code-komplett, aber inert ohne echte Tokens (Messenger Platform + Instagram Messaging).
import { createHmac, timingSafeEqual } from "node:crypto";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Senden über das Page-/IG-Postfach (RESPONSE = Antwort innerhalb des 24-h-Fensters). */
export async function sendMetaMessage(
  creds: { pageId: string; accessToken: string },
  recipientId: string,
  text: string,
): Promise<{ messageId: string }> {
  const res = await fetch(`${GRAPH}/${creds.pageId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text },
    }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `Meta HTTP ${res.status}`);
  }
  return { messageId: json.message_id ?? "" };
}

/** Best-effort: Anzeigename eines Social-Nutzers über die Graph API (für den Kundenabgleich). */
export async function getMetaUserName(accessToken: string, userId: string): Promise<string | null> {
  try {
    const res = await fetch(`${GRAPH}/${userId}?fields=name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.name ?? null;
  } catch {
    return null;
  }
}

/** Webhook-Echtheit: X-Hub-Signature-256 gegen den App-Secret prüfen. */
export function verifySignature(
  appSecret: string,
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const got = signatureHeader.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(got, "hex");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
