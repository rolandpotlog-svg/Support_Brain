// Monats-Defekt-Report als Excel (Gutschrift-Anfrage an den Supplier).
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { requireUser, brandAccess } from "@/server/access";
import { getMonthlyDefectReport } from "@/server/claims/monthly";

const require = createRequire(import.meta.url);

export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response("Nicht eingeloggt", { status: 401 });
  }
  const url = new URL(req.url);
  const shopId = url.searchParams.get("shop") ?? "";
  const month = url.searchParams.get("month") ?? undefined;
  const caps = shopId ? await brandAccess(user, shopId).catch(() => null) : null;
  if (!caps?.returns) return new Response("Kein Zugriff", { status: 403 });

  const rep = await getMonthlyDefectReport(shopId, month);
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  const e = (c: number) => c / 100;

  const aoa: (string | number)[][] = [
    [`Defekt-Report ${rep.label} — ${shop?.name ?? "Shop"}`],
    ["Grundlage für die Gutschrift-Anfrage an den Supplier"],
    [],
    ["Produkt", "Fälle", "Defekte Stück", "Gutschrift erhalten (€)"],
    ...rep.rows.map((r) => [r.product, r.claims, r.units, e(r.receivedCents)]),
    ["Summe", rep.totals.claims, rep.totals.units, e(rep.totals.receivedCents)],
  ];

  const XLSX = require("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 22 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Defekt-Report");
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const fname = `Defekt-Report_${rep.month}_${(shop?.name ?? "Shop").replace(/[^\w]+/g, "_")}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
