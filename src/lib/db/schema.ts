import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const membershipRole = pgEnum("membership_role", ["seller", "manager"]);
export const playbookStatus = pgEnum("playbook_status", ["draft", "active", "archived"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_org_user_unique").on(table.orgId, table.userId),
    index("memberships_user_id_idx").on(table.userId),
  ],
);

export const playbooks = pgTable(
  "playbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    status: playbookStatus("status").notNull().default("draft"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("playbooks_org_id_idx").on(table.orgId),
    uniqueIndex("playbooks_one_active_per_org")
      .on(table.orgId)
      .where(sql`${table.status} = 'active'`),
    check("playbooks_version_positive", sql`${table.version} >= 1`),
  ],
);

export const playbookPhases = pgTable(
  "playbook_phases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playbookId: uuid("playbook_id")
      .notNull()
      .references(() => playbooks.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    name: text("name").notNull(),
    triggerText: text("trigger_text").notNull().default(""),
    script: text("script").notNull().default(""),
    checklistItems: jsonb("checklist_items").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (table) => [uniqueIndex("playbook_phases_sort_unique").on(table.playbookId, table.sortOrder)],
);

export const playbookObjections = pgTable(
  "playbook_objections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playbookId: uuid("playbook_id")
      .notNull()
      .references(() => playbooks.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
    label: text("label").notNull(),
    signals: jsonb("signals").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    suggestedResponse: text("suggested_response").notNull().default(""),
  },
  (table) => [uniqueIndex("playbook_objections_sort_unique").on(table.playbookId, table.sortOrder)],
);

export type MembershipRole = (typeof membershipRole.enumValues)[number];
export type PlaybookStatus = (typeof playbookStatus.enumValues)[number];
