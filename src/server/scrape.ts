// Best-Effort-Website-Scraping fürs Shop-Profil: Startseite + wichtige Unterseiten
// (FAQ, Über uns, Versand/Retoure) holen und zu Text reduzieren. Kein externes Paket,
// reine fetch + HTML-Strip. Gescrapte Inhalte sind ein ENTWURF zum Prüfen.

export type ScrapedPage = { url: string; title: string; text: string };
export type ScrapeResult = { pages: ScrapedPage[]; fetchedAt: string };

const UA = "Mozilla/5.0 (compatible; SupportBrain/1.0; +profil-scrape)";
const PAGE_TIMEOUT_MS = 9000;
const MAX_TEXT = 6000;
const MAX_SUBPAGES = 4;

const SUBPAGE_KEYWORDS = [
  "faq", "hilfe", "help", "versand", "shipping", "lieferung",
  "retoure", "return", "rueckgabe", "rückgabe", "widerruf",
  "ueber", "über", "about", "agb",
];

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

async function fetchHtml(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function htmlToText(html: string): string {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(nav|footer|header|svg)[\s\S]*?<\/\1>/gi, " ");
  const text = decodeEntities(noScript.replace(/<[^>]+>/g, " "));
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

function extractTitle(html: string): string {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return t ? decodeEntities(t[1]).replace(/\s+/g, " ").trim().slice(0, 120) : "";
}

function findSubpages(html: string, origin: string): string[] {
  const found = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && found.size < 30) {
    const href = m[1];
    const anchor = decodeEntities(m[2].replace(/<[^>]+>/g, " ")).toLowerCase();
    const hay = `${href.toLowerCase()} ${anchor}`;
    if (!SUBPAGE_KEYWORDS.some((k) => hay.includes(k))) continue;
    let abs: URL;
    try {
      abs = new URL(href, origin);
    } catch {
      continue;
    }
    if (abs.origin !== origin) continue; // nur dieselbe Domain
    abs.hash = "";
    found.add(abs.toString());
  }
  return [...found].slice(0, MAX_SUBPAGES);
}

export async function scrapeWebsite(rawUrl: string): Promise<ScrapeResult> {
  const url = normalizeUrl(rawUrl);
  const pages: ScrapedPage[] = [];
  if (!url) return { pages, fetchedAt: new Date().toISOString() };

  const homeHtml = await fetchHtml(url);
  if (homeHtml) {
    const origin = new URL(url).origin;
    pages.push({ url, title: extractTitle(homeHtml) || "Startseite", text: htmlToText(homeHtml) });
    for (const sub of findSubpages(homeHtml, origin)) {
      const html = await fetchHtml(sub);
      if (html) pages.push({ url: sub, title: extractTitle(html) || sub, text: htmlToText(html) });
    }
  }
  return { pages, fetchedAt: new Date().toISOString() };
}
