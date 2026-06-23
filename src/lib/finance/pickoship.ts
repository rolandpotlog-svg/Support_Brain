// Pickoship-Rechnung (Text) parsen: Versand je Order aus der "Shipping Price"-Spalte
// (2. €-Wert vor dem nackten Amount). Liefert eine Kontroll-Summe gegen die Rechnung.

export type PickoshipOrder = { orderName: string; shippingCents: number };
export type PickoshipResult = {
  orders: PickoshipOrder[];
  parsedTotalCents: number;
  invoiceTotalCents: number | null;
  invoiceNumber: string | null;
  matches: boolean; // parsedTotal ≈ invoiceTotal (±1 €)
};

export function parsePickoshipText(text: string): PickoshipResult {
  const ship = new Map<string, number>();
  const idxs: { num: string; pos: number }[] = [];
  const re = /#(\d{3,5})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) idxs.push({ num: m[1], pos: m.index });

  for (let i = 0; i < idxs.length; i++) {
    const seg = text.slice(idxs[i].pos, i + 1 < idxs.length ? idxs[i + 1].pos : text.length);
    // Zeile: "QTY €ProduktPreis €Versand Amount" -> 2. €-Wert ist der Versand.
    const sm = seg.match(/€\s*\d+\.\d{2}\s+€\s*(\d+\.\d{2})\s+\d+\.\d{2}/);
    const cents = sm ? Math.round(parseFloat(sm[1]) * 100) : 0;
    ship.set(idxs[i].num, (ship.get(idxs[i].num) ?? 0) + cents);
  }

  const orders = [...ship.entries()]
    .map(([num, c]) => ({ orderName: `#${num}`, shippingCents: c }))
    .sort((a, b) => Number(a.orderName.slice(1)) - Number(b.orderName.slice(1)));
  const parsedTotalCents = orders.reduce((s, o) => s + o.shippingCents, 0);

  const inv = text.match(/Total Shipping Price\s*€?\s*([\d.]+)/i);
  const invoiceTotalCents = inv ? Math.round(parseFloat(inv[1]) * 100) : null;
  const invoiceNumber = text.match(/Invoice Number:\s*(\S+)/i)?.[1] ?? null;
  const matches = invoiceTotalCents !== null && Math.abs(parsedTotalCents - invoiceTotalCents) <= 100;

  return { orders, parsedTotalCents, invoiceTotalCents, invoiceNumber, matches };
}
