// AES-256-GCM für Postfach-Passwörter. MAILBOX_ENC_KEY = 32 Byte, base64.
// Erzeugen: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const k = Buffer.from(process.env.MAILBOX_ENC_KEY ?? "", "base64");
  if (k.length !== 32) {
    throw new Error("MAILBOX_ENC_KEY muss 32 Byte (base64-kodiert) sein");
  }
  return k;
}

// Format: base64(iv).base64(tag).base64(ciphertext)
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decrypt(token: string): string {
  const [ivB64, tagB64, dataB64] = token.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
