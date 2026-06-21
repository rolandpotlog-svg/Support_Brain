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

/** Öffentliche Antwort auf einen Kommentar (POST /{comment-id}/comments). */
export async function replyToComment(
  creds: { accessToken: string },
  commentId: string,
  text: string,
): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH}/${commentId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${creds.accessToken}` },
    body: JSON.stringify({ message: text }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `Meta HTTP ${res.status}`);
  return { id: json.id ?? "" };
}

/** Private Antwort (DM) aus einem Kommentar heraus (POST /{comment-id}/private_replies). */
export async function privateReplyToComment(
  creds: { accessToken: string },
  commentId: string,
  text: string,
): Promise<{ id: string }> {
  const res = await fetch(`${GRAPH}/${commentId}/private_replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${creds.accessToken}` },
    body: JSON.stringify({ message: text }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `Meta HTTP ${res.status}`);
  return { id: json.id ?? "" };
}

/** Kommentar ausblenden/einblenden (POST /{comment-id} is_hidden). */
export async function hideComment(
  creds: { accessToken: string },
  commentId: string,
  hidden: boolean,
): Promise<void> {
  const res = await fetch(`${GRAPH}/${commentId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${creds.accessToken}` },
    body: JSON.stringify({ is_hidden: hidden }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `Meta HTTP ${res.status}`);
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
