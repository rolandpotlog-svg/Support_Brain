// Drizzle-Schema — Support-Brain Phase 1.
// Logins liegen in UNSERER Postgres (users), Auth.js validiert dagegen.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ProfileData, ProfileSources } from "@/lib/profile/types";

export const threadStatus = pgEnum("thread_status", [
  "open",
  "pending",
  "escalated",
  "closed",
  "spam",
]);
export const messageDirection = pgEnum("message_direction", ["inbound", "outbound"]);
export const outboxStatus = pgEnum("outbox_status", ["pending", "sent", "failed"]);

// --- Logins / Rollen ---------------------------------------------------------
// role: "owner" (volle Kontrolle) | "member" (Rechte einzeln vom Owner freigeschaltet).
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("member"),
  active: boolean("active").notNull().default(true),
  // Vom Owner pro Nutzer freischaltbare Bereiche (Owner hat implizit alle).
  permReports: boolean("perm_reports").notNull().default(false),
  permCases: boolean("perm_cases").notNull().default(false),
  permShopsView: boolean("perm_shops_view").notNull().default(false),
  permShopsEdit: boolean("perm_shops_edit").notNull().default(false),
  permManageUsers: boolean("perm_manage_users").notNull().default(false),
  permReturns: boolean("perm_returns").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Shops (Rollout = nur Config) -------------------------------------------
export const shops = pgTable("shops", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  // Aktiv/inaktiv: inaktive Shops werden nicht gepollt und nicht im Umschalter gezeigt.
  active: boolean("active").notNull().default(true),
  // Kill-Switch: true => KI aus, reiner manueller Posteingang.
  killSwitch: boolean("kill_switch").notNull().default(false),
  // Automatischer Wochenbericht: Empfänger (kommagetrennt) + An/Aus.
  weeklyReportTo: text("weekly_report_to"),
  weeklyReportEnabled: boolean("weekly_report_enabled").notNull().default(false),
  // Neue Tickets beim Eingang automatisch von der KI taggen/klassifizieren.
  autoTag: boolean("auto_tag").notNull().default(false),
  // KI legt zu jeder neuen Kundenmail automatisch einen Entwurf an (je Shop einzeln einschaltbar).
  autoDraft: boolean("auto_draft").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Postfach-Konfiguration — MEHRERE pro Shop möglich (z. B. support@ + info@).
// Passwörter AES-256-GCM-verschlüsselt.
export const shopMailboxes = pgTable(
  "shop_mailboxes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    imapHost: text("imap_host").notNull(),
    imapPort: integer("imap_port").notNull().default(993),
    imapUser: text("imap_user").notNull(),
    imapPasswordEnc: text("imap_password_enc").notNull(),
    smtpHost: text("smtp_host").notNull(),
    smtpPort: integer("smtp_port").notNull().default(465),
    smtpUser: text("smtp_user").notNull(),
    smtpPasswordEnc: text("smtp_password_enc").notNull(),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    lastSeenUid: bigint("last_seen_uid", { mode: "number" }),
    // Schattenbetrieb: Postfach NUR LESEN (kein Gelesen-Markieren, kein Verschieben, keine Ordner,
    // kein Senden). Das Team arbeitet weiter im Webmail; die KI schreibt still mit und wird gegen
    // die echten Antworten aus dem Gesendet-Ordner verglichen.
    shadowMode: boolean("shadow_mode").notNull().default(false),
    lastSeenSentUid: bigint("last_seen_sent_uid", { mode: "number" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shop_mailboxes_shop_idx").on(t.shopId)],
);

// Shopify-Admin-API-Zugang je Shop. Token AES-256-GCM-verschlüsselt.
export const shopShopify = pgTable("shop_shopify", {
  shopId: uuid("shop_id")
    .primaryKey()
    .references(() => shops.id, { onDelete: "cascade" }),
  storeDomain: text("store_domain").notNull(), // z. B. deinshop.myshopify.com
  // Aktiver Admin-API-Token: entweder Legacy-shpat_ ODER der gecachte CCG-Token.
  adminTokenEnc: text("admin_token_enc"),
  // Client-Credentials-Grant (Dev-Dashboard-App): Tool holt den Token selbst.
  clientId: text("client_id"),
  clientSecretEnc: text("client_secret_enc"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Shop-Profil ("Antwort-Gehirn") je Shop: Felder, Feld-Herkunft, gebauter
// System-Prompt und der Roh-Quellen-Cache (Shopify-Snapshot + gescrapte Seiten).
export const shopProfile = pgTable("shop_profile", {
  shopId: uuid("shop_id")
    .primaryKey()
    .references(() => shops.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<ProfileData>(),
  sources: jsonb("sources").$type<ProfileSources>(),
  systemPrompt: text("system_prompt"),
  websiteUrl: text("website_url"),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shopifyData: jsonb("shopify_data").$type<any>(),
  shopifyFetchedAt: timestamp("shopify_fetched_at", { withTimezone: true }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scrapedData: jsonb("scraped_data").$type<any>(),
  scrapedAt: timestamp("scraped_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Einheitliches Fall-Objekt (provider-agnostisch): Shopify-Payments-Chargebacks
// (volle Bearbeitung) und PayPal-Käuferschutzfälle (read-only). `source` + `raw`
// halten das Modell offen für spätere Quellen/Alert-Feeds.
export const disputeCase = pgTable(
  "dispute_case",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // 'shopify_payments' | 'paypal'
    providerCaseId: text("provider_case_id").notNull(), // Shopify-Dispute-GID / PayPal-ID
    providerEvidenceId: text("provider_evidence_id"), // Shopify Dispute-Evidence-GID (zum Einreichen)
    orderId: text("order_id"), // Shopify-Bestell-GID
    orderName: text("order_name"), // z. B. #1264
    threadId: uuid("thread_id").references(() => threads.id, { onDelete: "set null" }),
    customerEmail: text("customer_email"),
    customerName: text("customer_name"),
    amount: text("amount"),
    currency: text("currency"),
    reason: text("reason"), // Reason-Enum (z. B. FRAUDULENT)
    reasonCode: text("reason_code"), // Network-Reason-Code (z. B. 4827)
    type: text("type"), // CHARGEBACK | INQUIRY
    status: text("status").notNull().default("needs_response"),
    dueBy: timestamp("due_by", { withTimezone: true }),
    initiatedAt: timestamp("initiated_at", { withTimezone: true }),
    evidence: jsonb("evidence").$type<Record<string, string>>(), // Beweis-Textfelder (Entwurf)
    decision: text("decision"), // 'fight' | 'accept' | null (Mensch)
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    outcome: text("outcome"), // 'won' | 'lost' | null
    externalUrl: text("external_url"), // PayPal-Link
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    raw: jsonb("raw").$type<any>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dispute_case_provider_uidx").on(t.shopId, t.source, t.providerCaseId),
    index("dispute_case_due_idx").on(t.status, t.dueBy),
  ],
);

// Audit-Log: jede Einreichung/Entscheidung protokollieren (wer/wann/was).
export const disputeAudit = pgTable("dispute_audit", {
  id: uuid("id").defaultRandom().primaryKey(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => disputeCase.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(), // submitted | decision_fight | decision_accept | evidence_saved | synced
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Social-Kanal (Meta): FB-Seite / IG-Business-Konto je Shop. Tokens verschlüsselt.
export const socialAccount = pgTable(
  "social_account",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // 'facebook' | 'instagram'
    pageId: text("page_id").notNull(), // FB-Page-ID bzw. IG-Business-Account-ID
    pageName: text("page_name"),
    accessTokenEnc: text("access_token_enc").notNull(),
    appSecretEnc: text("app_secret_enc"), // für Webhook-Signaturprüfung
    verifyToken: text("verify_token"), // Webhook-Verify-Handshake
    // Not-Aus: true => alle Kommentar-Antworten zurück auf Entwurf (kein Auto-Posten).
    autoStop: boolean("auto_stop").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("social_account_shop_channel_uidx").on(t.shopId, t.channel)],
);

// Öffentliche Kommentare unter Posts/Ads (FB). Höchste Vorsicht: Auto nur für
// sichere Kategorien (FAQ/Lob), Beschwerden/sensibel nie öffentlich automatisch.
export const socialComment = pgTable(
  "social_comment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => socialAccount.id, { onDelete: "cascade" }),
    postId: text("post_id"),
    adId: text("ad_id"),
    commentId: text("comment_id").notNull(), // Meta-Kommentar-ID (Dedup)
    parentCommentId: text("parent_comment_id"),
    fromId: text("from_id"),
    fromName: text("from_name"),
    message: text("message"),
    // KI: frage_faq | lob | beschwerde | bestellbezogen | spam | troll | offtopic
    intent: text("intent"),
    sentiment: text("sentiment"),
    confidence: integer("confidence"), // 0..100
    routeAction: text("route_action"), // public_reply | private_or_human | hide | skip
    visibility: text("visibility"), // public | private
    // new | drafted | posted | private_sent | hidden | escalated | skipped
    status: text("status").notNull().default("new"),
    draftText: text("draft_text"),
    postedText: text("posted_text"),
    auto: boolean("auto").notNull().default(false), // automatisch (ohne Mensch) verarbeitet?
    handledBy: uuid("handled_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("social_comment_commentid_uidx").on(t.commentId),
    index("social_comment_shop_status_idx").on(t.shopId, t.status, t.createdAt),
  ],
);

// Phasen-Autonomie pro Shop × Kategorie: Zähler erfolgreicher Freigaben + Auto-Schalter.
export const socialCategoryAutonomy = pgTable(
  "social_category_autonomy",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // intent
    approvedCount: integer("approved_count").notNull().default(0),
    autoEnabled: boolean("auto_enabled").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("social_autonomy_shop_cat_uidx").on(t.shopId, t.category)],
);

export const socialConversation = pgTable(
  "social_conversation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => socialAccount.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    externalUserId: text("external_user_id").notNull(), // PSID / IGSID
    userName: text("user_name"),
    // Best-effort-Verknüpfung zur Shopify-Bestellung/Kunde (vom Menschen bestätigt).
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    orderId: text("order_id"),
    orderName: text("order_name"),
    status: text("status").notNull().default("open"),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }), // für 24-h-Fenster
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("social_conv_account_user_uidx").on(t.accountId, t.externalUserId),
    index("social_conv_shop_idx").on(t.shopId, t.lastMessageAt),
  ],
);

export const socialMessage = pgTable(
  "social_message",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => socialConversation.id, { onDelete: "cascade" }),
    direction: messageDirection("direction").notNull(),
    text: text("text"),
    externalId: text("external_id"), // Meta-Message-ID (Dedup)
    sentBy: uuid("sent_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("social_msg_conv_idx").on(t.conversationId, t.createdAt),
    uniqueIndex("social_msg_external_uidx").on(t.externalId).where(sql`${t.externalId} is not null`),
  ],
);

// Welcher Agent sieht welche Shops (Admins sehen alles, in Code geprüft).
// Memberships: Zugehörigkeit Nutzer↔Brand MIT Rolle und Finance-Freigabe pro Brand.
// role: founder | admin | mitarbeiter | gast. finance_access nur TRUE bei founder/admin (DB-CHECK).
export const userShops = pgTable(
  "user_shops",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("mitarbeiter"),
    financeAccess: boolean("finance_access").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.shopId] })],
);

// --- Threads / Messages ------------------------------------------------------
export const threads = pgTable(
  "threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Fortlaufende, menschenlesbare Ticket-Nummer (#25 usw.).
    number: serial("number").notNull().unique(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    // Über welches Postfach das Ticket reinkam -> Antwort geht über dasselbe SMTP raus.
    mailboxId: uuid("mailbox_id").references(() => shopMailboxes.id, { onDelete: "set null" }),
    subject: text("subject"),
    customerEmail: text("customer_email").notNull(),
    customerName: text("customer_name"),
    status: threadStatus("status").notNull().default("open"),
    // Farbiger Kategorie-Tag (z. B. "Bestellstatus", "Beschädigte Ware").
    tag: text("tag"),
    assigneeId: uuid("assignee_id").references(() => users.id),
    // Manuell am Ticket gemerkte Bestellnummer (Abgleich-Override, hat Vorrang).
    manualOrderName: text("manual_order_name"),
    // Effizienz-Tracking: wann zuerst geantwortet / wann geschlossen.
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // Papierkorb: gesetzt = Ticket ausgeblendet, Mail wandert serverseitig in den Trash-Ordner.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // KI-Klassifizierung (einmalig je Ticket, dann deterministisch aggregiert).
    aiCategory: text("ai_category"),
    aiSentiment: text("ai_sentiment"),
    aiProduct: text("ai_product"),
    aiClassifiedAt: timestamp("ai_classified_at", { withTimezone: true }),
    // Zuletzt erzeugter KI-Entwurf (zum Vergleich beim Senden: 1:1 / bearbeitet).
    lastAiDraft: text("last_ai_draft"),
    // KI-Entscheidung zum aktuellen Entwurf: auto (KI kann allein) | mensch (Team entscheidet) + Grund.
    aiDecision: text("ai_decision"),
    aiReason: text("ai_reason"),
    // Wann der Entwurf erzeugt wurde — neuer als die letzte Kundenmail? Sonst erzeugt der Worker neu.
    aiDraftAt: timestamp("ai_draft_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("threads_shop_status_idx").on(t.shopId, t.status, t.lastMessageAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    direction: messageDirection("direction").notNull(),
    // Interne Team-Notiz (nicht an den Kunden, wird nie versendet).
    internal: boolean("internal").notNull().default(false),
    fromEmail: text("from_email").notNull(),
    toEmail: text("to_email"),
    subject: text("subject"),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    messageId: text("message_id"),
    inReplyTo: text("in_reply_to"),
    // Serverseitige IMAP-Position (für Ordner-Spiegelung): aktuelle UID + Ordner.
    imapUid: bigint("imap_uid", { mode: "number" }),
    imapFolder: text("imap_folder"),
    // KI-Entwurf-Nutzung bei ausgehenden Antworten: verbatim | edited | manual.
    aiOutcome: text("ai_outcome"),
    // Der ursprüngliche KI-Entwurf (für den Lern-Loop: was hat der Mitarbeiter geändert?).
    aiDraft: text("ai_draft"),
    // KI-Entscheidung zum Entwurf (auto | mensch) — für die Reife-Auswertung „30× unverändert“.
    aiDecision: text("ai_decision"),
    // Schattenbetrieb: Hätte der KI-Entwurf inhaltlich gepasst? + was abweicht (Lernsignal).
    aiShadowMatch: boolean("ai_shadow_match"),
    aiShadowNote: text("ai_shadow_note"),
    sentBy: uuid("sent_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_thread_idx").on(t.threadId, t.createdAt),
    // Dedup beim IMAP-Ingest: eine Message-ID global nur einmal.
    uniqueIndex("messages_message_id_uidx")
      .on(t.messageId)
      .where(sql`${t.messageId} is not null`),
  ],
);

// Ausgangs-Warteschlange: trennt "geschrieben" von "versendet".
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    status: outboxStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("outbox_pending_idx").on(t.status, t.createdAt)],
);

// Binärdaten (Mail-Anhänge) direkt in Postgres.
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// Anhänge (Fotos, PDFs …) einer Nachricht — eingehend (IMAP) wie ausgehend (Antwort).
export const messageAttachment = pgTable(
  "message_attachment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    content: bytea("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("message_attachment_msg_idx").on(t.messageId)],
);

export const escalations = pgTable(
  "escalations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    raisedBy: uuid("raised_by").references(() => users.id),
    reason: text("reason"),
    status: text("status").notNull().default("open"), // open | resolved
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("escalations_open_idx").on(t.status, t.createdAt)],
);

// --- Retouren-Portal (multi-tenant pro Shop) ---------------------------------
// Geldbeträge in Cent (Integer), um Float-Rundungsfehler zu vermeiden.
export const returnSettings = pgTable("return_settings", {
  shopId: uuid("shop_id")
    .primaryKey()
    .references(() => shops.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  cogsPct: integer("cogs_pct").notNull().default(40), // COGS = % vom Artikelpreis
  returnShippingCents: integer("return_shipping_cents").notNull().default(600),
  resaleableDefault: boolean("resaleable_default").notNull().default(true),
  voucherBonusPct: integer("voucher_bonus_pct").notNull().default(15), // Gutschein = +X% Wert
  firstOfferPct: integer("first_offer_pct").notNull().default(70), // 1. Angebot = % der Obergrenze
  fraudWindowDays: integer("fraud_window_days").notNull().default(60),
  fraudMaxKeepCents: integer("fraud_max_keep_cents").notNull().default(10000),
  highValueThresholdCents: integer("high_value_threshold_cents").notNull().default(15000),
  currency: text("currency").notNull().default("EUR"),
  accentColor: text("accent_color").notNull().default("#2b6ef2"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const returnReasons = pgTable(
  "return_reasons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    // keep_refund | exchange | defect_photo | support_redirect
    routing: text("routing").notNull(),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("return_reasons_shop_idx").on(t.shopId, t.sortOrder)],
);

export const returnCases = pgTable(
  "return_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    number: serial("number").notNull().unique(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    orderGid: text("order_gid"),
    orderName: text("order_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerName: text("customer_name"),
    // open | offered | accepted | declined | redirected | completed | cancelled
    status: text("status").notNull().default("open"),
    reasonRouting: text("reason_routing"),
    // [{ title, variantTitle, quantity, unitPriceCents, reasonLabel, routing }]
    items: jsonb("items").notNull().default([]),
    offerType: text("offer_type"), // partial_refund | voucher | exchange | none
    offerValueCents: integer("offer_value_cents"),
    offerStep: integer("offer_step").notNull().default(0),
    acceptedOfferType: text("accepted_offer_type"),
    acceptedValueCents: integer("accepted_value_cents"),
    recoveredValueCents: integer("recovered_value_cents").notNull().default(0),
    outcome: text("outcome"), // deflected_keep | refunded | exchanged | returned | redirected
    note: text("note"),
    // Wareneingang (physische Retoure im Lager): Eingang, Zustand, Restock.
    receivedAt: timestamp("received_at", { withTimezone: true }),
    condition: text("condition"), // resaleable | damaged
    restocked: boolean("restocked").notNull().default(false),
    receivedBy: uuid("received_by").references(() => users.id),
    threadId: uuid("thread_id").references(() => threads.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("return_cases_shop_idx").on(t.shopId, t.status, t.createdAt)],
);

export const returnTasks = pgTable(
  "return_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => returnCases.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    // refund | discount_code | draft_order | supplier_claim
    type: text("type").notNull(),
    title: text("title").notNull(),
    amountCents: integer("amount_cents"),
    deepLink: text("deep_link"),
    instruction: text("instruction"),
    status: text("status").notNull().default("pending"), // pending | done | skipped
    doneBy: uuid("done_by").references(() => users.id),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("return_tasks_open_idx").on(t.shopId, t.status, t.createdAt)],
);

// --- Finance / Controlling (PnL) — multi-tenant pro Brand (shop_id) ----------
// Geldbeträge in Cent. Wochen-Key = Montag (YYYY-MM-DD). finance_access-geschützt.
export const financeOrder = pgTable(
  "finance_order",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderName: text("order_name").notNull(),
    orderGid: text("order_gid"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    umsatzBruttoCents: integer("umsatz_brutto_cents").notNull().default(0),
    rabatteCents: integer("rabatte_cents").notNull().default(0),
    refundsCents: integer("refunds_cents").notNull().default(0),
    versandEinnahmeCents: integer("versand_einnahme_cents").notNull().default(0),
    ustCents: integer("ust_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    cogsCents: integer("cogs_cents").notNull().default(0),
    cogsUnknown: boolean("cogs_unknown").notNull().default(false),
    financialStatus: text("financial_status"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("finance_order_uidx").on(t.shopId, t.orderName),
    index("finance_order_week_idx").on(t.shopId, t.weekStart),
  ],
);

export const financeOrderItem = pgTable(
  "finance_order_item",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull().references(() => financeOrder.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    quantity: integer("quantity").notNull().default(1),
    sku: text("sku"),
    unitCogsCents: integer("unit_cogs_cents").notNull().default(0),
    lineCogsCents: integer("line_cogs_cents").notNull().default(0),
    mapped: boolean("mapped").notNull().default(true),
  },
  (t) => [index("finance_item_order_idx").on(t.orderId)],
);

// Versand je Order (Pickoship). source: ledger | manual | pending.
export const financeShipping = pgTable(
  "finance_shipping",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderName: text("order_name").notNull(),
    shippingCents: integer("shipping_cents").notNull().default(0),
    // Echte Produktkosten (COGS) aus der Supplier-Rechnung. null = noch nicht verbucht
    // -> Report nutzt dann den Shopify-Richtwert (Menge × Stückkost).
    invoiceCogsCents: integer("invoice_cogs_cents"),
    source: text("source").notNull().default("manual"),
    contaminated: boolean("contaminated").notNull().default(false),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("finance_shipping_uidx").on(t.shopId, t.orderName)],
);

// Marketing-Spend je Woche × Kanal.
export const financeMarketing = pgTable(
  "finance_marketing",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    channel: text("channel").notNull(), // meta | meta_garten | google | taboola | tiktok
    amountCents: integer("amount_cents").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("finance_marketing_uidx").on(t.shopId, t.weekStart, t.channel)],
);

// Manuelle Fix-/Variable-Kosten je Woche.
export const financeCostOverride = pgTable(
  "finance_cost_override",
  {
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    fixkostenCents: integer("fixkosten_cents").notNull().default(0),
    variableCents: integer("variable_cents").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.weekStart] })],
);

// Historische/importierte Wochen-Aggregate (aus PnL-Blueprint-Excel) für Wochen,
// die der Shopify-Store nicht (mehr) liefert. Report: Shopify hat Vorrang, sonst dies.
export const financeWeekManual = pgTable(
  "finance_week_manual",
  {
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    umsatzBruttoCents: integer("umsatz_brutto_cents").notNull().default(0),
    rabatteCents: integer("rabatte_cents").notNull().default(0),
    refundsCents: integer("refunds_cents").notNull().default(0),
    versandEinnahmeCents: integer("versand_einnahme_cents").notNull().default(0),
    ustCents: integer("ust_cents").notNull().default(0),
    cogsCents: integer("cogs_cents").notNull().default(0),
    versandkostenCents: integer("versandkosten_cents").notNull().default(0),
    source: text("source").notNull().default("blueprint"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.weekStart] })],
);

// Editierbare Basis-Stückkosten (COGS) je Brand. Supplier ändert Preise -> hier
// eintragen, neue/laufende Wochen rechnen automatisch nach. Bundle-/Mengen-Logik
// bleibt im Code (cogs.ts). Historische Wochen (Excel) bleiben unberührt.
export const financeCogsRate = pgTable(
  "finance_cogs_rate",
  {
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    unitCents: integer("unit_cents").notNull().default(0),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.key] })],
);

// Einkaufspreis je Produkt (für Shops OHNE feste Regel-Engine, z. B. Lovenja mit vielen Varianten).
// Schlüssel = normalisierter Produkttitel aus Shopify (Line-Item-Titel).
export const financeProductCost = pgTable(
  "finance_product_cost",
  {
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    productKey: text("product_key").notNull(),
    label: text("label").notNull(),
    unitCents: integer("unit_cents").notNull().default(0),
    source: text("source").notNull().default("manuell"), // manuell | shopify
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.productKey] })],
);

// Supplier-Reklamationen: defekte Artikel, die wir beim Supplier reklamieren
// (aus Wareneingang/Retoure oder manuell). Jede Reklamation -> Trello-Karte für
// den Supplier; monatlicher Defekt-Report für Gutschrift-Anfrage.
export const supplierClaim = pgTable(
  "supplier_claim",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    orderName: text("order_name"), // zugehörige Bestellung "#1234" (optional)
    productLabel: text("product_label").notNull(), // Artikel/Kategorie
    sku: text("sku"),
    quantity: integer("quantity").notNull().default(1),
    reason: text("reason").notNull(), // Defekt-Beschreibung
    status: text("status").notNull().default("offen"), // offen|gesendet|gutschrift|ersetzt|abgelehnt
    creditCents: integer("credit_cents").notNull().default(0), // erhaltene Gutschrift
    source: text("source").notNull().default("manuell"), // manuell|wareneingang
    trelloCardId: text("trello_card_id"),
    trelloCardUrl: text("trello_card_url"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("supplier_claim_shop_idx").on(t.shopId, t.createdAt)],
);

// Meta-Ads-Verbindung je Brand/Kanal (für automatischen Marketing-Import in die PnL).
// Token AES-verschlüsselt; nur die Meta-Kanäle (meta, meta_garten) nutzen das.
export const financeAdsAccount = pgTable(
  "finance_ads_account",
  {
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // meta | meta_garten
    accountId: text("account_id").notNull(), // Werbekonto-ID (act_… ohne Präfix)
    tokenEnc: text("token_enc").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.channel] })],
);

// Google-Ads-Verbindung je Brand (automatischer Marketing-Import in die PnL).
// Mehrere Secrets (Developer-Token, Client-Secret, Refresh-Token) AES-verschlüsselt.
export const financeGoogleAds = pgTable("finance_google_ads", {
  shopId: uuid("shop_id").primaryKey().references(() => shops.id, { onDelete: "cascade" }),
  customerId: text("customer_id").notNull(), // 10-stellige Kunden-ID (ohne Bindestriche)
  loginCustomerId: text("login_customer_id"), // MCC/Manager-ID (optional)
  clientId: text("client_id").notNull(),
  clientSecretEnc: text("client_secret_enc").notNull(),
  developerTokenEnc: text("developer_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Interne Roadmap/ToDo-Liste (Owner-only): Build-Fortschritt abhaken + Offenes pflegen.
export const devTodo = pgTable("dev_todo", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("Allgemein"),
  status: text("status").notNull().default("offen"), // offen | erledigt
  note: text("note"),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  doneAt: timestamp("done_at", { withTimezone: true }),
});

// Tages-Spend-Audit (für Zeitfenster Heute/Rolling-7). Roh aus Meta/Google,
// idempotent je Brand+Konto-Kanal+Tag. Wochensumme bleibt in financeMarketing.
export const financeMarketingDaily = pgTable(
  "finance_marketing_daily",
  {
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    amountCents: integer("amount_cents").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.channel, t.date] })],
);

// Refunds mit Erstattungs-Datum (Shopify-Logik: Rückgaben zählen in der Woche der
// Erstattung, nicht der Bestellung). Pro Shopify-Refund eine Zeile, idempotent.
export const financeRefund = pgTable(
  "finance_refund",
  {
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    refundId: text("refund_id").notNull(), // Shopify-Refund-GID
    orderName: text("order_name"),
    refundedAt: date("refunded_at", { mode: "string" }).notNull(),
    refundWeek: date("refund_week", { mode: "string" }).notNull(), // Montag der Erstattungs-Woche
    amountCents: integer("amount_cents").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.refundId] }), index("finance_refund_week_idx").on(t.shopId, t.refundWeek)],
);

// Textbausteine / Schnellantworten je Brand (im Antwort-Feld einfügbar).
export const cannedReply = pgTable(
  "canned_reply",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("canned_reply_shop_idx").on(t.shopId)],
);

// Feedback/Ideen von Mitarbeitern an den Owner.
export const feedback = pgTable("feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  userEmail: text("user_email"),
  // Zu welchem Shop die Notiz gehört (aktiver Shop beim Schreiben). null = Altbestand (nur Owner/Autor sehen sie).
  shopId: uuid("shop_id").references(() => shops.id, { onDelete: "set null" }),
  kind: text("kind").notNull().default("idee"), // idee | bug
  text: text("text").notNull(),
  status: text("status").notNull().default("neu"), // neu | erledigt
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
