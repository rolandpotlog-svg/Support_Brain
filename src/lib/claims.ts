// Client-sichere Reklamations-Konstanten (kein DB-Import).
export const CLAIM_STATUSES = ["offen", "gesendet", "gutschrift", "ersetzt", "abgelehnt"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const CLAIM_STATUS_LABEL: Record<string, string> = {
  offen: "Offen",
  gesendet: "An Supplier gesendet",
  gutschrift: "Gutschrift erhalten",
  ersetzt: "Ersatz erhalten",
  abgelehnt: "Abgelehnt",
};
