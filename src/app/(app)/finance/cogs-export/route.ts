// Download der aktuellen Basis-Stückkosten als Excel (immer current).
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { requireUser, brandAccess } from "@/server/access";
import { getCogsRateRows } from "@/server/finance/cogs-rates";

const require = createRequire(import.meta.url);

export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response("Nicht eingeloggt", { status: 401 });
  }
  const shopId = new URL(req.url).searchParams.get("shop") ?? "";
  const caps = shopId ? await brandAccess(user, shopId).catch(() => null) : null;
  if (!caps?.finance) return new Response("Kein Zugriff", { status: 403 });

  const rows = await getCogsRateRows(shopId);
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  const bundle = rows.find((r) => r.key === "sonic_pulse_bundle")?.unitCents ?? 0;

  const aoa: (string | number)[][] = [
    [`Basis-Stückkosten (COGS) — ${shop?.name ?? "Shop"}`],
    ["Stand", new Date().toLocaleDateString("de-DE")],
    [],
    ["Produkt", "Stückkost (€)", "Bundle / Menge", "Quelle"],
    ...rows.map((r) => [
      r.label,
      r.unitCents / 100,
      r.hint,
      r.isDefault ? "Standard" : r.updatedAt ? `geändert ${new Date(r.updatedAt).toLocaleDateString("de-DE")}` : "",
    ]),
    [],
    ["Abgeleitet — Sonic Pulse Pro:"],
    ["1× / 2× (1 Bundle)", bundle / 100],
    ["4× (2 Bundles)", (bundle * 2) / 100],
    ["6× (3 Bundles)", (bundle * 3) / 100],
    ["Probiergerät (1 Gerät)", Math.round(bundle / 2) / 100],
  ];

  const XLSX = require("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 30 }, { wch: 22 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Stückkosten");
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const fname = `Stueckkosten_${(shop?.name ?? "Shop").replace(/[^\w]+/g, "_")}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
