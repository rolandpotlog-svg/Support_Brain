import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { brandAccess, requireUser } from "@/server/access";
import { loadShopForEdit } from "@/server/shop-config";
import { loadProfile } from "@/server/profile";
import { loadSocialAccounts } from "@/server/social-config";
import { ShopForm } from "../shop-form";
import { ProfileForm } from "../profile-form";
import { SocialConfig } from "../social-config";
import { LoadDefaults } from "../load-defaults";
import { PaypalAccess } from "../paypal-access";
import { paypalSiblingShops } from "@/server/paypal-disputes";
import { AutoSendSettings } from "../auto-send-settings";
import { intentReadiness } from "@/server/ai/readiness";
import { NEVER_AUTO } from "@/server/ai/check";
import { INTENTS } from "@/lib/support/intents";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";

export default async function EditShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; shopify?: string; shopify_error?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await brandAccess(user, id)).settings) redirect("/inbox");
  const { tab, shopify, shopify_error } = await searchParams;
  const shop = await loadShopForEdit(id);
  if (!shop) notFound();

  const activeTab = tab === "profil" ? "profil" : tab === "social" ? "social" : tab === "automatik" ? "automatik" : "zugang";
  const auto = activeTab === "automatik" ? await loadAutoTab(id) : null;
  const profile = activeTab === "profil" ? await loadProfile(id) : null;
  const social = activeTab === "social" ? await loadSocialAccounts(id) : null;
  const pp = activeTab === "zugang" ? await db.query.shopPaypal.findFirst({ where: eq(schema.shopPaypal.shopId, id) }) : null;
  const ppSiblings = pp ? await paypalSiblingShops(id) : [];

  return (
    <div className="adminwrap">
      <div className="formhead">
        <Link href="/admin/shops" className="back">← Shops</Link>
        <h1>{shop.name}</h1>
      </div>

      {shopify === "ok" && (
        <div className="formerror" style={{ background: "#dcfce7", color: "#166534" }}>
          ✓ Shopify autorisiert — Token gespeichert. „Verbindung testen" zur Kontrolle.
        </div>
      )}
      {shopify_error && <div className="formerror">Shopify-OAuth-Fehler: {shopify_error}</div>}

      <div className="tabnav">
        <Link href={`/admin/shops/${id}`} className={activeTab === "zugang" ? "active" : ""}>
          Zugang
        </Link>
        <Link href={`/admin/shops/${id}?tab=profil`} className={activeTab === "profil" ? "active" : ""}>
          Shop-Profil
        </Link>
        <Link href={`/admin/shops/${id}?tab=social`} className={activeTab === "social" ? "active" : ""}>
          Social (Meta)
        </Link>
        <Link href={`/admin/shops/${id}?tab=automatik`} className={activeTab === "automatik" ? "active" : ""}>
          Automatik
        </Link>
      </div>

      {activeTab === "automatik" && auto && <AutoSendSettings shopId={id} isOwner={user.isOwner} {...auto} />}
      {activeTab === "zugang" && <ShopForm initial={shop} hideHead />}
      {activeTab === "zugang" && (
        <PaypalAccess
          shopId={id}
          initial={pp ? { clientId: pp.clientId, mode: pp.mode, hasSecret: true, lastSyncAt: pp.lastSyncAt?.toISOString() ?? null, lastError: pp.lastError } : null}
          sharedWith={ppSiblings.map((s) => s.name)}
        />
      )}
      {activeTab === "profil" && <LoadDefaults shopId={id} />}
      {activeTab === "profil" && (
        <ProfileForm
          shopId={id}
          shopName={shop.name}
          shopifyConfigured={shop.shopify.configured}
          initial={profile!}
        />
      )}
      {activeTab === "social" && <SocialConfig shopId={id} accounts={social!} />}
    </div>
  );
}

/** Daten für den Tab „Automatik“: Einstellungen, Reife je Anliegen, Kennzahlen, Stichprobe. */
async function loadAutoTab(shopId: string) {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  const ready = await intentReadiness(shopId);
  const readiness = INTENTS.map((i) => {
    const r = ready.find((x) => x.intent === i.key);
    return { intent: i.key, label: i.label, verbatim: r?.verbatim ?? 0, edited: r?.edited ?? 0, pct: r?.pct ?? null, ready: r?.ready ?? false, never: NEVER_AUTO.has(i.key) };
  });
  const rows = (q: ReturnType<typeof sql>) => db.execute(q).then((r) => ((r as unknown as { rows?: Record<string, unknown>[] }).rows ?? (r as unknown as Record<string, unknown>[])));
  const [st] = await rows(sql`
    select
      count(*) filter (where o.status = 'sent' and m.created_at > now() - interval '7 days')::int as sent7,
      count(*) filter (where o.status = 'sent' and m.created_at > now() - interval '7 days' and exists (
        select 1 from messages i where i.thread_id = m.thread_id and i.direction = 'inbound' and i.created_at > m.created_at and i.created_at < m.created_at + interval '3 days'))::int as reply7,
      count(*) filter (where o.status = 'pending')::int as pending_now,
      count(*) filter (where (m.created_at at time zone 'Europe/Vienna')::date = (now() at time zone 'Europe/Vienna')::date)::int as today
    from messages m join threads t on t.id = m.thread_id join outbox o on o.message_id = m.id
    where t.shop_id = ${shopId} and m.ai_outcome = 'auto'`);
  const sample = await rows(sql`
    select m.thread_id, t.number, t.subject, left(regexp_replace(m.body_text, '\s+', ' ', 'g'), 160) as excerpt, m.created_at,
      exists (select 1 from messages i where i.thread_id = m.thread_id and i.direction = 'inbound' and i.created_at > m.created_at) as replied
    from messages m join threads t on t.id = m.thread_id join outbox o on o.message_id = m.id
    where t.shop_id = ${shopId} and m.ai_outcome = 'auto' and o.status = 'sent' and m.created_at > now() - interval '7 days'
    order by random() limit 10`);
  return {
    initial: {
      autoSend: shop?.autoSend ?? false,
      intents: shop?.autoSendIntents ?? [],
      delayMin: shop?.autoSendDelayMin ?? 10,
      dailyMax: shop?.autoSendDailyMax ?? 50,
      killSwitch: shop?.killSwitch ?? false,
    },
    readiness,
    stats: { sent7: Number(st?.sent7 ?? 0), reply7: Number(st?.reply7 ?? 0), pendingNow: Number(st?.pending_now ?? 0), today: Number(st?.today ?? 0) },
    sample: sample.map((r) => ({
      threadId: String(r.thread_id),
      number: Number(r.number),
      subject: (r.subject as string | null) ?? null,
      excerpt: String(r.excerpt ?? ""),
      at: new Date(String(r.created_at)).toISOString(),
      customerReplied: Boolean(r.replied),
    })),
  };
}
