// Meta-Ads (Graph API): tägliche Werbeausgaben eines Werbekontos. Nur lesend (ads_read).
const API = "https://graph.facebook.com/v21.0";

export type DailySpend = { date: string; spendCents: number };

/** "act_123" / "123" -> "act_123". */
function normAccount(id: string): string {
  const n = id.trim().replace(/^act_/i, "");
  return `act_${n}`;
}

/** Tägliche Ausgaben (date_start, spend) im Zeitraum, inkl. Paginierung. */
export async function getDailySpend(
  token: string,
  accountId: string,
  since: string,
  until: string,
): Promise<DailySpend[]> {
  const params = new URLSearchParams({
    fields: "spend",
    level: "account",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    limit: "500",
    access_token: token,
  });
  let url = `${API}/${normAccount(accountId)}/insights?${params.toString()}`;
  const out: DailySpend[] = [];

  for (let guard = 0; guard < 50 && url; guard++) {
    const res = await fetch(url);
    const json = (await res.json()) as {
      data?: { spend?: string; date_start?: string }[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!res.ok || json.error) {
      throw new Error(`Meta-API: ${json.error?.message ?? res.status}`);
    }
    for (const row of json.data ?? []) {
      if (!row.date_start) continue;
      out.push({ date: row.date_start, spendCents: Math.round(parseFloat(row.spend ?? "0") * 100) });
    }
    url = json.paging?.next ?? "";
  }
  return out;
}

/** Token-Schnelltest: Werbekonto-Name lesen (validiert Token + Konto-ID). */
export async function checkAdsAccount(token: string, accountId: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  const params = new URLSearchParams({ fields: "name,currency", access_token: token });
  const res = await fetch(`${API}/${normAccount(accountId)}?${params.toString()}`);
  const json = (await res.json()) as { name?: string; error?: { message?: string } };
  if (!res.ok || json.error) return { ok: false, error: json.error?.message ?? `HTTP ${res.status}` };
  return { ok: true, name: json.name };
}
