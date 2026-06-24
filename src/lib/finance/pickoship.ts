// Pickoship-Rechnung (Text) parsen.
// Versand: "Shipping Price"-Spalte (2. €-Wert vor dem Amount), je Order.
// Produktkosten (COGS): QTY × "Product Price" (1. €-Wert) je Item — NICHT die
// AMOUNT-Spalte (die ist Versand + ggf. Produkt gemischt). Beide gegen die
// Rechnungs-Summen (Total Shipping / Total Product Price) kontrollierbar.

export type PickoshipOrder = { orderName: string; shippingCents: number; productCents: number };
export type PickoshipResult = {
  orders: PickoshipOrder[];
  parsedTotalCents: number; // Versand-Summe (geparst)
  invoiceTotalCents: number | null; // Versand-Summe lt. Rechnung
  productTotalCents: number; // Produktkosten-Summe (geparst, qty×Stückpreis)
  invoiceProductTotalCents: number | null; // Produktkosten lt. Rechnung ("Total Product Price")
  unitPrices: { price: number; qty: number }[]; // Stückpreise im PDF (Cent) + Stückzahl
  invoiceNumber: string | null;
  matches: boolean; // Versand: parsed ≈ Rechnung (±1 €)
  productMatches: boolean; // Produkt: parsed ≈ Rechnung (±1 €)
};

// Ein Item-Block: "<qty> €<Stückpreis> [€<Versand> <Amount>]" — der optionale
// Teil wird mitgegriffen, damit der zweite €-Wert nicht als neues Item fehlmatcht.
const ITEM_RE = /(\d+)\s+€\s*(\d+\.\d{2})(?:\s+€\s*(\d+\.\d{2})\s+(\d+\.\d{2}))?/g;

export function parsePickoshipText(text: string): PickoshipResult {
  const ship = new Map<string, number>();
  const prod = new Map<string, number>();
  const unit = new Map<number, number>(); // Stückpreis(Cent) -> Stückzahl
  const idxs: { num: string; pos: number }[] = [];
  const re = /#(\d{3,5})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) idxs.push({ num: m[1], pos: m.index });

  for (let i = 0; i < idxs.length; i++) {
    const seg = text.slice(idxs[i].pos, i + 1 < idxs.length ? idxs[i + 1].pos : text.length);
    // Versand: 2. €-Wert vor dem nackten Amount (wie gehabt).
    const sm = seg.match(/€\s*\d+\.\d{2}\s+€\s*(\d+\.\d{2})\s+\d+\.\d{2}/);
    ship.set(idxs[i].num, (ship.get(idxs[i].num) ?? 0) + (sm ? Math.round(parseFloat(sm[1]) * 100) : 0));

    // Produktkosten: alle Items im Segment, qty × Stückpreis.
    ITEM_RE.lastIndex = 0;
    let pm: RegExpExecArray | null;
    let segProd = 0;
    while ((pm = ITEM_RE.exec(seg))) {
      const qty = parseInt(pm[1], 10);
      const ppCents = Math.round(parseFloat(pm[2]) * 100);
      segProd += qty * ppCents;
      unit.set(ppCents, (unit.get(ppCents) ?? 0) + qty);
    }
    prod.set(idxs[i].num, (prod.get(idxs[i].num) ?? 0) + segProd);
  }

  const orders = [...ship.keys()]
    .map((num) => ({ orderName: `#${num}`, shippingCents: ship.get(num) ?? 0, productCents: prod.get(num) ?? 0 }))
    .sort((a, b) => Number(a.orderName.slice(1)) - Number(b.orderName.slice(1)));
  const parsedTotalCents = orders.reduce((s, o) => s + o.shippingCents, 0);
  const productTotalCents = orders.reduce((s, o) => s + o.productCents, 0);

  const inv = text.match(/Total Shipping Price\s*€?\s*([\d.]+)/i);
  const invoiceTotalCents = inv ? Math.round(parseFloat(inv[1]) * 100) : null;
  const invP = text.match(/Total Product Price\s*€?\s*([\d.]+)/i);
  const invoiceProductTotalCents = invP ? Math.round(parseFloat(invP[1]) * 100) : null;
  const invoiceNumber = text.match(/Invoice Number:\s*(\S+)/i)?.[1] ?? null;

  const matches = invoiceTotalCents !== null && Math.abs(parsedTotalCents - invoiceTotalCents) <= 100;
  const productMatches = invoiceProductTotalCents !== null && Math.abs(productTotalCents - invoiceProductTotalCents) <= 100;
  const unitPrices = [...unit.entries()].map(([price, qty]) => ({ price, qty })).sort((a, b) => b.price - a.price);

  return {
    orders,
    parsedTotalCents,
    invoiceTotalCents,
    productTotalCents,
    invoiceProductTotalCents,
    unitPrices,
    invoiceNumber,
    matches,
    productMatches,
  };
}
