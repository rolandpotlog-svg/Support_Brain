"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { selectActiveShop } from "@/server/actions/inbox";

/** Aktiven Shop auf den Shop des geöffneten Tickets umstellen (Hinweis bei Shop-Wechsel über einen Link). */
export function SwitchShopButton({ shopId, name }: { shopId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await selectActiveShop(shopId);
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      Zu {name} wechseln
    </button>
  );
}
