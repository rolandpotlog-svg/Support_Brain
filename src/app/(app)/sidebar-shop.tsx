"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { selectActiveShop } from "@/server/actions/inbox";

type Shop = { id: string; name: string; color: string };

/** Globaler Shop-Umschalter in der linken Rail. Einmal wählen → gilt überall. */
export function SidebarShop({ shops, activeId }: { shops: Shop[]; activeId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = shops.find((s) => s.id === activeId);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (shops.length === 0) return null;

  async function pick(id: string) {
    setOpen(false);
    if (id === activeId) return;
    setBusy(true);
    try {
      await selectActiveShop(id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const single = shops.length <= 1;
  return (
    <div className="railshop" ref={ref}>
      <button
        type="button"
        className="railshop-btn"
        style={active ? { background: active.color, borderColor: active.color, color: "#fff" } : undefined}
        title={active ? `Shop: ${active.name}` : "Shop wählen"}
        aria-label={active ? `Aktiver Shop: ${active.name}. Umschalten` : "Shop wählen"}
        onClick={() => !single && setOpen((o) => !o)}
        disabled={busy}
      >
        {(active?.name ?? "?").slice(0, 2)}
      </button>
      {open && !single && (
        <div className="railshop-menu" role="menu">
          <div className="railshop-menu-head">Shop wählen</div>
          {shops.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitemradio"
              aria-checked={s.id === activeId}
              className={s.id === activeId ? "active" : ""}
              onClick={() => pick(s.id)}
            >
              <span className="railshop-dot" style={{ background: s.color }} />
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
