import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { setSocialAutoStop } from "@/server/actions/social-comments";
import {
  AUTONOMY_THRESHOLD,
  AUTO_SAFE_INTENTS,
  INTENT_LABEL,
  ROUTE_LABEL,
  normalizeIntent,
  type RouteAction,
} from "@/lib/social/comments";
import { CommentActions } from "./comment-actions";

const STATUS_LABEL: Record<string, string> = {
  new: "Neu",
  drafted: "Entwurf",
  escalated: "Eskaliert",
  posted: "Öffentlich gepostet",
  private_sent: "Privat beantwortet",
  hidden: "Ausgeblendet",
  skipped: "Verworfen",
};
const ACTIVE = new Set(["new", "drafted", "escalated"]);

export default async function CommentsPage() {
  const user = await requireUser();

  const accessible = await accessibleShopIds(user);
  const shopList = accessible.length
    ? await db
        .select({ id: schema.shops.id, name: schema.shops.name })
        .from(schema.shops)
        .where(and(inArray(schema.shops.id, accessible), eq(schema.shops.active, true)))
        .orderBy(schema.shops.name)
    : [];
  const activeShopId = await getActiveShopId(shopList.map((s) => s.id));
  if (!activeShopId) redirect("/social");

  const account = await db.query.socialAccount.findFirst({
    where: and(eq(schema.socialAccount.shopId, activeShopId), eq(schema.socialAccount.channel, "facebook")),
  });

  const comments = await db
    .select()
    .from(schema.socialComment)
    .where(eq(schema.socialComment.shopId, activeShopId))
    .orderBy(desc(schema.socialComment.createdAt))
    .limit(50);

  const autonomy = await db
    .select()
    .from(schema.socialCategoryAutonomy)
    .where(eq(schema.socialCategoryAutonomy.shopId, activeShopId));
  const autoMap = new Map(autonomy.map((a) => [a.category, a]));

  return (
    <div className="adminwrap">
      <div className="formhead" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>FB-Kommentare</h1>
        <div className="srcrow">
          <Link href="/social" className="btnlink">← Social</Link>
        </div>
      </div>

      {!account ? (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            Facebook ist für diesen Shop nicht verbunden — die Kommentar-Erfassung ist inaktiv.
            Im Admin (Social) den Page-Token + Webhook hinterlegen, dann erscheinen hier Kommentare unter Posts/Ads.
          </p>
        </section>
      ) : (
        <section className="card">
          <div className="cardhead">
            <h2 style={{ margin: 0 }}>Autonomie &amp; Sicherheit</h2>
            <form action={setSocialAutoStop.bind(null, account.id, !account.autoStop)}>
              <button className={`btnlink ${account.autoStop ? "primary" : ""}`} type="submit">
                {account.autoStop ? "Not-Aus aktiv — Auto wieder erlauben" : "🛑 Not-Aus (alles auf Entwurf)"}
              </button>
            </form>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            Öffentliche Auto-Antworten nur für sichere Kategorien und erst nach {AUTONOMY_THRESHOLD} Freigaben.
            Beschwerden/Negatives bleiben immer beim Menschen oder gehen privat.
          </p>
          <ul className="esc-list">
            {AUTO_SAFE_INTENTS.map((cat) => {
              const a = autoMap.get(cat);
              const count = a?.approvedCount ?? 0;
              const on = a?.autoEnabled ?? false;
              return (
                <li key={cat}>
                  {INTENT_LABEL[cat]}: <strong>{Math.min(count, AUTONOMY_THRESHOLD)}/{AUTONOMY_THRESHOLD}</strong>{" "}
                  {on && !account.autoStop ? "· ✅ AUTO aktiv" : "· Entwurf"}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {comments.length === 0 && (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>Noch keine Kommentare erfasst.</p>
        </section>
      )}

      {comments.map((c) => {
        const intent = normalizeIntent(c.intent);
        const active = ACTIVE.has(c.status);
        return (
          <section className="card" key={c.id}>
            <div className="cardhead">
              <h2 style={{ margin: 0, fontSize: 16 }}>{c.fromName || "Unbekannt"}</h2>
              <span className="muted">{c.postId ? `Post ${c.postId}` : ""}{c.auto ? " · auto" : ""}</span>
            </div>
            <p style={{ margin: "4px 0" }}>{c.message}</p>
            <div className="srcrow" style={{ flexWrap: "wrap", fontSize: 13 }}>
              <span className="sbadge">{INTENT_LABEL[intent]}</span>
              <span className="muted">{c.sentiment ?? "?"} · Sicherheit {c.confidence ?? 0}%</span>
              <span className="muted">→ {ROUTE_LABEL[(c.routeAction ?? "skip") as RouteAction]}</span>
              {!active && <span className="sbadge paid">{STATUS_LABEL[c.status] ?? c.status}</span>}
            </div>
            {active && <CommentActions id={c.id} routeAction={c.routeAction} draftText={c.draftText} />}
          </section>
        );
      })}
    </div>
  );
}
