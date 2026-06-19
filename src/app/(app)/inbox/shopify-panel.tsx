"use client";
import { useCallback, useEffect, useState } from "react";
import {
  loadCustomerOrders,
  manualSearch,
  pickCandidate,
  resolveThreadShopify,
} from "@/server/actions/shopify";
import type { Resolution } from "@/lib/shopify/order-match";
import type { ShopifyCustomer, ShopifyOrder } from "@/lib/shopify/client";
import { trackingUrl } from "@/lib/shopify/client";
import { euro, initials } from "@/lib/format";

function Badges({ order }: { order: ShopifyOrder }) {
  const paid = (order.financialStatus ?? "").toUpperCase() === "PAID";
  const fulfilled = (order.fulfillmentStatus ?? "").toUpperCase() === "FULFILLED";
  return (
    <div className="badges">
      <span className={`sbadge ${paid ? "paid" : "unpaid"}`}>{paid ? "Bezahlt" : order.financialStatus || "Offen"}</span>
      <span className={`sbadge ${fulfilled ? "fulfilled" : "unfulfilled"}`}>{fulfilled ? "Versendet" : order.fulfillmentStatus || "Nicht versendet"}</span>
    </div>
  );
}

function OrderBlock({ order }: { order: ShopifyOrder }) {
  return (
    <>
      <div className="sec">
        <div className="order-head">
          <span className="onum">{order.name}</span>
          <span className="oamt">{order.total ? euro(order.total.amount, order.total.currencyCode) : "—"}</span>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {new Date(order.createdAt).toLocaleDateString("de-DE")}
        </div>
        <Badges order={order} />
      </div>

      {order.tracking.length > 0 && (
        <div className="sec">
          <div className="sec-label">Sendungsverfolgung</div>
          {order.tracking.map((t, i) => {
            const url = trackingUrl(t);
            return (
              <div className="track" key={i}>
                <span className="carrier">{t.company || "Carrier"}</span>
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer">{t.number || "Sendung verfolgen"}</a>
                ) : (
                  <span>{t.number || "—"}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {order.lineItems.length > 0 && (
        <div className="sec">
          <div className="sec-label">Artikel ({order.lineItems.length})</div>
          {order.lineItems.map((li, i) => (
            <div className="lineitem" key={i}>
              {li.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="thumb" src={li.imageUrl} alt={li.title} />
              ) : (
                <div className="thumb" />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="li-title">{li.title}</div>
                <div className="li-meta">
                  {li.variantTitle ? `${li.variantTitle} · ` : ""}
                  {li.quantity}×
                </div>
              </div>
              <div className="li-price">{li.price ? euro(li.price.amount, li.price.currencyCode) : ""}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function CustomerHead({ customer }: { customer: ShopifyCustomer | null }) {
  if (!customer) return null;
  return (
    <div className="sec">
      <div className="sec-label">Kundendaten</div>
      <div className="cust">
        <div className="cav">{initials(customer.displayName, customer.email ?? "?")}</div>
        <div style={{ minWidth: 0 }}>
          <div className="cname">{customer.displayName}</div>
          <div className="cmail">{customer.email}</div>
        </div>
      </div>
      <div className="stats">
        <div className="stat">
          <div className="k">CLTV</div>
          <div className="v">{customer.amountSpent ? euro(customer.amountSpent.amount, customer.amountSpent.currencyCode) : "—"}</div>
        </div>
        <div className="stat">
          <div className="k">Bestellungen</div>
          <div className="v">{customer.numberOfOrders}</div>
        </div>
      </div>
    </div>
  );
}

function ManualSearch({ shopId, onResult }: { shopId: string; onResult: (r: Resolution) => void }) {
  const [type, setType] = useState<"order" | "email" | "name">("order");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="sec">
      <div className="sec-label">Manuelle Suche</div>
      <div style={{ display: "grid", gap: 8 }}>
        <select value={type} onChange={(e) => setType(e.target.value as "order")}>
          <option value="order">Bestellnummer</option>
          <option value="email">E-Mail</option>
          <option value="name">Name</option>
        </select>
        <input placeholder="Suchbegriff…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button
          disabled={busy || !q.trim()}
          onClick={async () => {
            setBusy(true);
            onResult(await manualSearch(shopId, type, q));
            setBusy(false);
          }}
        >
          {busy ? "Sucht…" : "Suchen"}
        </button>
      </div>
    </div>
  );
}

export function ShopifyPanel({ threadId, shopId }: { threadId: string; shopId: string }) {
  const [res, setRes] = useState<Resolution | null>(null);
  // Lokale Navigation für E-Mail/Kunden-Modus (durchblätterbare Bestellungen).
  const [orders, setOrders] = useState<ShopifyOrder[]>([]);
  const [idx, setIdx] = useState(0);
  const [cursorNext, setCursorNext] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [customer, setCustomer] = useState<ShopifyCustomer | null>(null);
  const [navBusy, setNavBusy] = useState(false);

  const applyCustomer = useCallback((r: Extract<Resolution, { mode: "customer" }>) => {
    setCustomer(r.customer);
    setOrders(r.orders);
    setCursorNext(r.hasNext ? r.cursor : null);
    setTotal(r.total);
    setIdx(0);
  }, []);

  const apply = useCallback(
    (r: Resolution) => {
      setRes(r);
      if (r.mode === "customer") applyCustomer(r);
    },
    [applyCustomer],
  );

  useEffect(() => {
    setRes(null);
    resolveThreadShopify(threadId).then(apply);
  }, [threadId, apply]);

  async function next() {
    if (!customer) return;
    if (idx + 1 < orders.length) return setIdx(idx + 1);
    if (!cursorNext) return;
    setNavBusy(true);
    const o = await loadCustomerOrders(shopId, customer.id, cursorNext);
    setNavBusy(false);
    if (o.orders.length) {
      setOrders([...orders, ...o.orders]);
      setCursorNext(o.hasNext ? o.cursor : null);
      setIdx(idx + 1);
    }
  }

  if (res === null) return <div className="sec muted">Lädt Shopify-Daten…</div>;

  if (res.mode === "unconfigured") {
    return (
      <div className="sec">
        <div className="note">
          Shopify ist für diesen Shop noch nicht verbunden. Im <b>Admin</b> unter
          {" "}<b>Shopify-Zugang</b> Store-Domain &amp; Admin-API-Token hinterlegen, dann
          erscheinen hier Kunde &amp; Bestellungen.
        </div>
      </div>
    );
  }

  if (res.mode === "error") {
    return (
      <>
        <div className="sec"><div className="note">Shopify-Fehler: {res.message}</div></div>
        <ManualSearch shopId={shopId} onResult={apply} />
      </>
    );
  }

  if (res.mode === "order") {
    return (
      <>
        <CustomerHead customer={res.customer} />
        <OrderBlock order={res.order} />
        <ManualSearch shopId={shopId} onResult={apply} />
      </>
    );
  }

  if (res.mode === "candidates") {
    return (
      <>
        <div className="sec">
          <div className="note">Mehrere mögliche Kunden über den Namen gefunden — bitte den richtigen wählen:</div>
        </div>
        <div className="sec">
          {res.candidates.map((c) => (
            <button
              key={c.id}
              className="candidate"
              onClick={async () => setRes(await pickCandidate(shopId, c))}
            >
              <div className="cav">{initials(c.displayName, c.email ?? "?")}</div>
              <div style={{ minWidth: 0 }}>
                <div className="cname">{c.displayName}</div>
                <div className="cmail">{c.email} · {c.numberOfOrders} Best.</div>
              </div>
            </button>
          ))}
        </div>
        <ManualSearch shopId={shopId} onResult={apply} />
      </>
    );
  }

  if (res.mode === "none") {
    return (
      <>
        <div className="sec"><div className="note">Keine Shopify-Bestellung gefunden.</div></div>
        <ManualSearch shopId={shopId} onResult={apply} />
      </>
    );
  }

  // res.mode === "customer"
  const current = orders[idx];
  return (
    <>
      <CustomerHead customer={customer} />
      {current ? (
        <>
          <div className="sec" style={{ paddingBottom: 0, borderBottom: "none" }}>
            <div className="pager">
              <span className="sec-label" style={{ margin: 0 }}>Bestellung</span>
              <span style={{ flex: 1 }} />
              <button disabled={idx === 0 || navBusy} onClick={() => setIdx(idx - 1)}>‹</button>
              <span className="pinfo">{idx + 1}/{total}</span>
              <button disabled={navBusy || (idx + 1 >= orders.length && !cursorNext)} onClick={next}>›</button>
            </div>
          </div>
          <OrderBlock order={current} />
        </>
      ) : (
        <div className="sec muted">Keine Bestellungen für diesen Kunden.</div>
      )}
    </>
  );
}
