// Trello-Anbindung für Supplier-Reklamationen (der Supplier in China arbeitet in Trello).
// Phase 2: erstellt je Reklamation eine Karte im Supplier-Board.
// Aktuell no-op, bis Trello-Zugang (API-Key + Token + Board/Liste) hinterlegt ist.
import type { ClaimRow } from "@/server/claims/report";

export async function pushClaimToTrello(_claim: ClaimRow): Promise<{ cardId: string; url: string } | null> {
  // TODO Phase 2: Trello-Config (verschlüsselt) laden; POST https://api.trello.com/1/cards
  //   key, token, idList, name = "[#order] Produkt × Menge", desc = Defekt-Grund.
  // Danach trelloCardId/-Url an der Reklamation speichern.
  return null;
}
