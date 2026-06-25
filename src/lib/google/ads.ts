// Google-Ads-API: Werbekosten je Tag. OAuth2 (Refresh-Token) -> Access-Token,
// dann GAQL-Query auf metrics.cost_micros. Nur lesend.
const API_VERSION = "v18"; // bei Bedarf hochziehen, wenn Google die Version abkündigt
const ADS_API = `https://googleads.googleapis.com/${API_VERSION}`;

export type GoogleAdsConfig = {
  customerId: string;
  loginCustomerId?: string | null;
  clientId: string;
  clientSecret: string;
  developerToken: string;
  refreshToken: string;
};

export type DailyCost = { date: string; costCents: number };

const digits = (s: string) => (s || "").replace(/\D/g, "");

/** Access-Token aus dem Refresh-Token holen. */
async function getAccessToken(cfg: GoogleAdsConfig): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string; error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`OAuth: ${json.error_description ?? json.error ?? res.status}`);
  }
  return json.access_token;
}

async function gaql(cfg: GoogleAdsConfig, accessToken: string, query: string): Promise<Record<string, unknown>[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": cfg.developerToken,
    "Content-Type": "application/json",
  };
  if (cfg.loginCustomerId) headers["login-customer-id"] = digits(cfg.loginCustomerId);

  const rows: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const res = await fetch(`${ADS_API}/customers/${digits(cfg.customerId)}/googleAds:search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
    });
    const json = (await res.json()) as {
      results?: Record<string, unknown>[];
      nextPageToken?: string;
      error?: { message?: string };
    };
    if (!res.ok || json.error) throw new Error(`Google-Ads: ${json.error?.message ?? res.status}`);
    rows.push(...(json.results ?? []));
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return rows;
}

/** Tägliche Kosten (date, costCents) im Zeitraum. */
export async function getDailyCost(cfg: GoogleAdsConfig, since: string, until: string): Promise<DailyCost[]> {
  const accessToken = await getAccessToken(cfg);
  const query = `SELECT segments.date, metrics.cost_micros FROM customer WHERE segments.date BETWEEN '${since}' AND '${until}'`;
  const rows = await gaql(cfg, accessToken, query);
  return rows.map((r) => {
    const seg = r.segments as { date?: string } | undefined;
    const met = r.metrics as { costMicros?: string | number } | undefined;
    const micros = Number(met?.costMicros ?? 0);
    return { date: seg?.date ?? "", costCents: Math.round(micros / 10_000) };
  }).filter((d) => d.date);
}

/** Verbindung testen: Access-Token holen + Mini-Query. */
export async function checkConfig(cfg: GoogleAdsConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const accessToken = await getAccessToken(cfg);
    await gaql(cfg, accessToken, "SELECT customer.id FROM customer LIMIT 1");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
