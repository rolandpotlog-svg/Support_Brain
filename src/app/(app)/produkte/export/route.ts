// Supplier-Liste als Excel: je Produkt die Probleme mit Anzahl, Vorzeitraum und Beispielen.
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { brandAccess, requireUser } from "@/server/access";
import { productInsights } from "@/server/product-insights";

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
  const days = Math.min(365, Math.max(7, Number(url.searchParams.get("d") ?? 30) || 30));
  const caps = shopId ? await brandAccess(user, shopId).catch(() => null) : null;
  if (!caps?.reports) return new Response("Kein Zugriff", { status: 403 });

  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  const { rows } = await productInsights(shopId, days);
  const today = new Date().toLocaleDateString("de-DE");
  const aoa: (string | number)[][] = [
    [`Produkt-Probleme ${shop?.name ?? ""} — letzte ${days} Tage (Stand ${today})`],
    [],
    ["Produkt", "Problem", `Anzahl (${days} T.)`, "Vorzeitraum", "Retouren", "Reklamierte Stück", "Beispiele (Kundenaussagen)"],
  ];
  for (const r of rows) {
    const problems = r.issues.length ? r.issues : [{ issue: "—", n: 0, prev: 0, examples: [] }];
    problems.forEach((i, idx) =>
      aoa.push([
        idx === 0 ? r.product : "",
        i.issue,
        i.n,
        i.prev,
        idx === 0 ? r.returns : "",
        idx === 0 ? r.claims : "",
        i.examples.map((e) => e.summary).join(" | "),
      ]),
    );
  }
  const XLSX = require("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 36 }, { wch: 26 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 90 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Produkt-Probleme");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const fname = `Produkt-Probleme_${(shop?.slug ?? "shop")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
