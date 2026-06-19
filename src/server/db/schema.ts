// Drizzle-Schema — Support-Brain Phase 1.
// Logins liegen in UNSERER Postgres (users), Auth.js validiert dagegen.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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

export const userRole = pgEnum("user_role", ["agent", "admin"]);
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
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("agent"),
  active: boolean("active").notNull().default(true),
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
  adminTokenEnc: text("admin_token_enc").notNull(),
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

// Welcher Agent sieht welche Shops (Admins sehen alles, in Code geprüft).
export const userShops = pgTable(
  "user_shops",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
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
    fromEmail: text("from_email").notNull(),
    toEmail: text("to_email"),
    subject: text("subject"),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    messageId: text("message_id"),
    inReplyTo: text("in_reply_to"),
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
