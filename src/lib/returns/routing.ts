// Grund-basiertes Routing: jeder Retouren-Grund führt in einen Ablauf.
export type Routing = "keep_refund" | "exchange" | "defect_photo" | "support_redirect";

export const ROUTINGS: Routing[] = ["keep_refund", "exchange", "defect_photo", "support_redirect"];

export const ROUTING_LABEL: Record<Routing, string> = {
  keep_refund: "Behalten + Teilerstattung",
  exchange: "Umtausch (richtige Variante)",
  defect_photo: "Defekt (Foto statt Rücksendung)",
  support_redirect: "An Support/Tracking",
};

export function isRouting(s: string): s is Routing {
  return (ROUTINGS as string[]).includes(s);
}

/** Default-Gründe, die beim Aktivieren des Portals angelegt werden. */
export function defaultReasons(): { label: string; routing: Routing; sortOrder: number }[] {
  return [
    { label: "Gefällt nicht / Meinung geändert", routing: "keep_refund", sortOrder: 0 },
    { label: "Falsche Größe / Variante", routing: "exchange", sortOrder: 1 },
    { label: "Artikel defekt / beschädigt", routing: "defect_photo", sortOrder: 2 },
    { label: "Nicht angekommen / zu spät", routing: "support_redirect", sortOrder: 3 },
  ];
}
