"use client";
import { useCallback, useEffect, useState } from "react";
import {
  loadCustomerOrders,
  manualSearch,
  pickCandidate,
  refundOrder,
  resolveThreadShopify,
  setThreadOrder,
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

type RefundCtx = { shopId: string; threadId: string; customerName: string };

function RefundBox({ ctx, order }: { ctx: RefundCtx; order: ShopifyOrder }) {
  const totalMajor = order.total ? parseFloat(order.total.amount) : 0;
  const cur = order.total?.currencyCode ?? "EUR";
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const preset = (pct: number) => setAmount(((totalMajor * pct) / 100).toFixed(2));
  const amountCents = Math.round(parseFloat(amount || "0") * 100);
  const valid = amountCents > 0;

  async function doRefund() {
    setBusy(true);
    setErr(null);
    try {
      const r = await refundOrder({
        shopId: ctx.shopId,
        threadId: ctx.threadId,
        orderId: order.id,
        orderName: order.name,
        amountCents,
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setDone(`${r.refundedAmount} ${r.currency}`);
      setConfirming(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="sec">
        <div className="sec-label">Erstattung</div>
        <div className="ok-text" style={{ fontSize: 13 }}>
          ✓ {done} an {ctx.customerName || "den Kunden"} erstattet.
        </div>
      </div>
    );
  }

  return (
    <div className="sec">
      <div className="sec-label">Erstattung (Kulanz)</div>
      {!confirming ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {[30, 50, 100].map((p) => (
              <button
                key={p}
                className="candidate"
                style={{ justifyContent: "center", padding: "6px 8px" }}
                onClick={() => preset(p)}
                type="button"
              >
                {p}%
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              inputMode="decimal"
              placeholder="Betrag"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              style={{ flex: 1 }}
            />
            <span className="muted" style={{ fontSize: 12 }}>{cur}</span>
          </div>
          <button className="primary" disabled={!valid} onClick={() => { setErr(null); setConfirming(true); }} type="button">
            {valid ? `${amount} ${cur} erstatten` : "Betrag wählen"}
          </button>
          {err && <div className="formerror" style={{ margin: 0, fontSize: 12 }}>{err}</div>}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <div className="note" style={{ fontSize: 13 }}>
            Wirklich <b>{amount} {cur}</b> an <b>{ctx.customerName || "den Kunden"}</b> für <b>{order.name}</b> zurückerstatten?
            <br />
            Das bewegt <b>echtes Geld</b> und kann nicht rückgängig gemacht werden.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="primary"
              disabled={busy}
              onClick={doRefund}
              type="button"
              style={{ background: "var(--danger, #e5634d)", borderColor: "transparent" }}
            >
              {busy ? "Erstattet…" : "Ja, jetzt erstatten"}
            </button>
            <button className="btnlink" disabled={busy} onClick={() => setConfirming(false)} type="button">Abbrechen</button>
          </div>
          {err && <div className="formerror" style={{ margin: 0, fontSize: 12 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}

function OrderBlock({ order, refundCtx }: { order: ShopifyOrder; refundCtx?: RefundCtx }) {
  const refundable =
    !!order.total && ["PAID", "PARTIALLY_REFUNDED"].includes((order.financialStatus ?? "").toUpperCase());
  // Rabatt-%: Shopifys exakter %-Wert, sonst effektiv aus €-Rabatt / (Summe + Rabatt) berechnet.
  const discAmt = order.totalDiscount ? parseFloat(order.totalDiscount.amount) : 0;
  const grossApprox = order.total ? parseFloat(order.total.amount) + discAmt : 0;
  const discPct =
    order.discountPercentage ?? (discAmt > 0 && grossApprox > 0 ? Math.round((discAmt / grossApprox) * 100) : null);
  const pctExact = order.discountPercentage != null;
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

      <div className="sec">
        <div className="sec-label">Rabatt (diese Bestellung)</div>
        {order.discountCodes.length > 0 || order.totalDiscount ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {order.discountCodes.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {order.discountCodes.map((code, i) => {
                  const known = /welcome|newsletter/i.test(code);
                  return (
                    <span
                      key={i}
                      className={`sbadge ${known ? "paid" : "unfulfilled"}`}
                      style={{ textTransform: "uppercase" }}
                      title={known ? "Welcome/Newsletter-Rabatt" : "Rabattcode"}
                    >
                      🏷 {code}
                    </span>
                  );
                })}
              </div>
            )}
            {(discPct != null || order.totalDiscount) && (
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--danger, #e5634d)" }}>
                {discPct != null && <span>−{pctExact ? "" : "≈"}{discPct}% </span>}
                {order.totalDiscount && (
                  <span className="muted" style={{ fontWeight: 500 }}>
                    (−{euro(order.totalDiscount.amount, order.totalDiscount.currencyCode)})
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>Kein Rabatt genutzt</div>
        )}
      </div>

      {order.shippingAddress && (
        <div className="sec">
          <div className="sec-label">Lieferadresse</div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            {order.shippingAddress.name && <div>{order.shippingAddress.name}</div>}
            {order.shippingAddress.address1 && <div>{order.shippingAddress.address1}</div>}
            {order.shippingAddress.address2 && <div>{order.shippingAddress.address2}</div>}
            <div>{[order.shippingAddress.zip, order.shippingAddress.city].filter(Boolean).join(" ")}</div>
            {(order.shippingAddress.province || order.shippingAddress.country) && (
              <div className="muted">
                {[order.shippingAddress.province, order.shippingAddress.country].filter(Boolean).join(", ")}
              </div>
            )}
            {order.shippingAddress.phone && <div className="muted">📞 {order.shippingAddress.phone}</div>}
          </div>
        </div>
      )}

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
                {li.properties.length > 0 && (
                  <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                    {li.properties.map((p, j) => (
                      <div
                        key={j}
                        style={{
                          fontSize: 12,
                          background: "var(--panel-2)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: "3px 7px",
                          wordBreak: "break-word",
                        }}
                      >
                        <span className="muted">✏️ {p.key}: </span>
                        <b>{p.value}</b>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="li-price">{li.price ? euro(li.price.amount, li.price.currencyCode) : ""}</div>
            </div>
          ))}
        </div>
      )}

      {refundCtx && refundable && <RefundBox ctx={refundCtx} order={order} />}
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

function PinOrder({ threadId, orderName, onResult }: { threadId: string; orderName: string; onResult: (r: Resolution) => void }) {
  const [busy, setBusy] = useState(false);
  const [pinned, setPinned] = useState(false);
  return (
    <div className="sec">
      <button
        className="candidate"
        style={{ width: "100%", justifyContent: "center" }}
        disabled={busy || pinned}
        onClick={async () => {
          setBusy(true);
          const r = await setThreadOrder(threadId, orderName);
          setPinned(true);
          setBusy(false);
          onResult(r);
        }}
      >
        {pinned ? "📌 Am Ticket gemerkt" : busy ? "Merke…" : "📌 Diese Bestellung am Ticket merken"}
      </button>
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
      if (r.mode === "orders") {
        setCustomer(null);
        setOrders(r.orders);
        setCursorNext(null);
        setTotal(r.orders.length);
        setIdx(0);
      }
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

  if (res.mode === "mismatch") {
    // Bestellnummer aus der Mail gehört einem ANDEREN Kunden -> nicht als Kundenbestellung anzeigen.
    return (
      <>
        <div className="sec">
          <div className="note note-bad">
            <b>Keine passende Bestellung für diesen Absender.</b> Die Nummer <b>#{res.orderNumber}</b> aus der Mail gehört zu einem
            anderen Kunden ({res.order.shippingAddress?.name ?? res.customer?.displayName ?? "?"}) — E-Mail und Name passen nicht.
            Vielleicht ein Tippfehler oder eine Bestellung bei einem anderen Shop. Die KI nennt keine Bestelldetails.
          </div>
        </div>
        <div className="sec">
          <details>
            <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Fremde Bestellung trotzdem ansehen</summary>
            <OrderBlock order={res.order} refundCtx={{ shopId, threadId, customerName: res.customer?.displayName ?? "" }} />
            <PinOrder threadId={threadId} orderName={res.order.name} onResult={apply} />
          </details>
        </div>
        <ManualSearch shopId={shopId} onResult={apply} />
      </>
    );
  }

  if (res.mode === "order") {
    return (
      <>
        {res.verified === "name" && (
          <div className="sec">
            <div className="note">Kunde schreibt von einer <b>anderen E-Mail</b> als bei der Bestellung ({res.order.email ?? "—"}). Name und Bestellnummer passen — bitte kurz prüfen.</div>
          </div>
        )}
        <CustomerHead customer={res.customer} />
        <OrderBlock order={res.order} refundCtx={{ shopId, threadId, customerName: res.customer?.displayName ?? "" }} />
        <PinOrder threadId={threadId} orderName={res.order.name} onResult={apply} />
        <ManualSearch shopId={shopId} onResult={apply} />
      </>
    );
  }

  if (res.mode === "orders") {
    const current = orders[idx];
    return (
      <>
        {res.note && <div className="sec"><div className="note">{res.note}</div></div>}
        <div className="sec"><div className="sec-label">Bestellungen über die E-Mail (Gast)</div></div>
        {current ? (
          <>
            <div className="sec" style={{ paddingBottom: 0, borderBottom: "none" }}>
              <div className="pager">
                <span className="sec-label" style={{ margin: 0 }}>Bestellung</span>
                <span style={{ flex: 1 }} />
                <button disabled={idx === 0} onClick={() => setIdx(idx - 1)}>‹</button>
                <span className="pinfo">{idx + 1}/{orders.length}</span>
                <button disabled={idx + 1 >= orders.length} onClick={() => setIdx(idx + 1)}>›</button>
              </div>
            </div>
            <OrderBlock order={current} refundCtx={{ shopId, threadId, customerName: "" }} />
            <PinOrder threadId={threadId} orderName={current.name} onResult={apply} />
          </>
        ) : (
          <div className="sec muted">Keine Bestellungen.</div>
        )}
        <ManualSearch shopId={shopId} onResult={apply} />
      </>
    );
  }

  if (res.mode === "candidates") {
    return (
      <>
        <div className="sec">
          <div className="note">Nur über den <b>Namen</b> gefunden (E-Mail unbekannt) — das ist keine sichere Zuordnung. Bitte prüfen und den richtigen Kunden wählen:</div>
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
        <div className="sec"><div className="note"><b>Keine passende Bestellung gefunden</b> — weder über Bestellnummer, E-Mail noch Namen. Vielleicht hat sich der Kunde vertan oder meint einen anderen Shop. Die KI fragt höflich nach Bestellnummer bzw. Bestell-E-Mail.</div></div>
        <ManualSearch shopId={shopId} onResult={apply} />
      </>
    );
  }

  // res.mode === "customer"
  const current = orders[idx];
  return (
    <>
      {res.mode === "customer" && res.note && <div className="sec"><div className="note">{res.note}</div></div>}
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
          <OrderBlock order={current} refundCtx={{ shopId, threadId, customerName: customer?.displayName ?? "" }} />
          <PinOrder threadId={threadId} orderName={current.name} onResult={apply} />
        </>
      ) : (
        <div className="sec muted">Keine Bestellungen für diesen Kunden.</div>
      )}
      <ManualSearch shopId={shopId} onResult={apply} />
    </>
  );
}
