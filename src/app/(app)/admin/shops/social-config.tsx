import { saveSocialAccount } from "@/server/actions/social";
import type { SocialAccountView } from "@/server/social-config";

function block(shopId: string, channel: string, label: string, acc: SocialAccountView | undefined) {
  return (
    <form className="invite" action={saveSocialAccount} style={{ maxWidth: 560, marginBottom: 18 }}>
      <input type="hidden" name="shopId" value={shopId} />
      <input type="hidden" name="channel" value={channel} />
      <div className="row" style={{ alignItems: "center" }}>
        <strong style={{ flex: "0 0 auto" }}>{label}</strong>
        <span className={acc?.configured ? "sbadge paid" : "muted"}>
          {acc?.configured ? `verbunden${acc.pageName ? ` · ${acc.pageName}` : ""}` : "nicht verbunden"}
        </span>
      </div>
      <div className="row">
        <input
          name="pageId"
          placeholder={channel === "facebook" ? "Facebook-Seiten-ID" : "Instagram-Business-Account-ID"}
          defaultValue={acc?.pageId ?? ""}
        />
        <input name="pageName" placeholder="Anzeigename (optional)" defaultValue={acc?.pageName ?? ""} />
      </div>
      <div className="row">
        <input
          name="accessToken"
          type="password"
          placeholder={acc?.configured ? "Access-Token (leer = behalten)" : "Page-Access-Token"}
        />
        <input
          name="appSecret"
          type="password"
          placeholder={acc?.hasAppSecret ? "App-Secret (leer = behalten)" : "App-Secret (Webhook-Signatur)"}
        />
      </div>
      <div className="row">
        <input
          name="verifyToken"
          placeholder={acc?.hasVerifyToken ? "Verify-Token (leer = behalten)" : "Webhook-Verify-Token"}
        />
      </div>
      <button className="primary" type="submit">Speichern</button>
    </form>
  );
}

export function SocialConfig({ shopId, accounts }: { shopId: string; accounts: SocialAccountView[] }) {
  const fb = accounts.find((a) => a.channel === "facebook");
  const ig = accounts.find((a) => a.channel === "instagram");
  return (
    <div className="shopform">
      <section className="card">
        <h2>Social (Meta)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Eigene FB-Seite + IG-Business-Konto je Shop (nicht die Meta-Ads-Verbindung). Tokens werden
          verschlüsselt gespeichert. Webhook-URL: <code>/api/meta/webhook</code> — Meta braucht eine
          öffentlich erreichbare HTTPS-Adresse (lokal per Tunnel). Messaging-Berechtigungen erfordern
          eine Meta-App mit App-Review.
        </p>
        {block(shopId, "facebook", "Facebook Messenger", fb)}
        {block(shopId, "instagram", "Instagram DMs", ig)}
      </section>
    </div>
  );
}
