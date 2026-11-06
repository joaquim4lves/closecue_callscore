import { sql } from "drizzle-orm";
import {
  boolean,
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

export const scoreStatus = pgEnum("score_status", ["ok", "failed"]);
export const callSource = pgEnum("call_source", ["upload", "paste", "meet", "zoom", "fireflies"]);
export const callStatus = pgEnum("call_status", ["pending", "processing", "ready", "failed"]);
export const segmentSpeaker = pgEnum("segment_speaker", ["seller", "prospect", "unknown"]);
export const webhookProvider = pgEnum("webhook_provider", ["meet", "zoom", "fireflies"]);

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    playbookId: uuid("playbook_id").references(() => playbooks.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    source: callSource("source").notNull(),
    externalId: text("external_id"),
    status: callStatus("status").notNull().default("pending"),
    audioUrl: text("audio_url"),
    audioContentType: text("audio_content_type"),
    durationSec: integer("duration_sec"),
    consentRecordedAt: timestamp("consent_recorded_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("calls_org_created_idx").on(table.orgId, table.createdAt),
    uniqueIndex("calls_org_source_external_unique")
      .on(table.orgId, table.source, table.externalId)
      .where(sql`${table.externalId} is not null`),
  ],
);

export const transcripts = pgTable("transcripts", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id")
    .notNull()
    .unique()
    .references(() => calls.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  rawJson: jsonb("raw_json").$type<unknown>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transcriptId: uuid("transcript_id")
      .notNull()
      .references(() => transcripts.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    tStartMs: integer("t_start_ms").notNull(),
    tEndMs: integer("t_end_ms").notNull(),
    speaker: segmentSpeaker("speaker").notNull(),
    text: text("text").notNull(),
  },
  (table) => [uniqueIndex("transcript_segments_idx_unique").on(table.transcriptId, table.idx)],
);

export const webhookInbox = pgTable(
  "webhook_inbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: webhookProvider("provider").notNull(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
    headersHash: text("headers_hash").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    signatureOk: boolean("signature_ok").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("webhook_inbox_created_idx").on(table.createdAt)],
);

export const retentionPolicies = pgTable(
  "retention_policies",
  {
    orgId: uuid("org_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    audioDays: integer("audio_days").notNull().default(30),
    transcriptDays: integer("transcript_days").notNull().default(90),
    badScoreBelow: integer("bad_score_below").notNull().default(60),
  },
  (table) => [
    check("retention_audio_days_positive", sql`${table.audioDays} > 0`),
    check("retention_transcript_days_positive", sql`${table.transcriptDays} > 0`),
    check("retention_bad_score_range", sql`${table.badScoreBelow} >= 0 AND ${table.badScoreBelow} <= 100`),
  ],
);

export const scores = pgTable(
  "scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id")
      .notNull()
      .unique()
      .references(() => calls.id, { onDelete: "cascade" }),
    playbookId: uuid("playbook_id").references(() => playbooks.id, { onDelete: "set null" }),
    playbookVersion: integer("playbook_version").notNull(),
    overall: integer("overall"),
    badFlag: boolean("bad_flag").notNull().default(false),
    shortReason: text("short_reason"),
    phaseScores: jsonb("phase_scores").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    objectionScores: jsonb("objection_scores").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    reasons: jsonb("reasons").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    model: text("model"),
    promptVersion: text("prompt_version"),
    status: scoreStatus("status").notNull(),
    errorMessage: text("error_message"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("scores_overall_range", sql`${table.overall} IS NULL OR (${table.overall} >= 0 AND ${table.overall} <= 100)`),
    check("scores_ok_has_overall", sql`${table.status} <> 'ok' OR ${table.overall} IS NOT NULL`),
  ],
);

export type MembershipRole = (typeof membershipRole.enumValues)[number];
export type PlaybookStatus = (typeof playbookStatus.enumValues)[number];
export type CallSource = (typeof callSource.enumValues)[number];
export type CallStatus = (typeof callStatus.enumValues)[number];
export type SegmentSpeaker = (typeof segmentSpeaker.enumValues)[number];
export const cueSessionStatus = pgEnum("cue_session_status", ["idle", "live", "ended"]);

export const cueSessions = pgTable("cue_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  sellerId: uuid("seller_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
  playbookId: uuid("playbook_id").references(() => playbooks.id, { onDelete: "set null" }),
  playbookVersion: integer("playbook_version"),
  status: cueSessionStatus("status").notNull().default("idle"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const cueEvents = pgTable("cue_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => cueSessions.id, { onDelete: "cascade" }),
  phaseId: uuid("phase_id").references(() => playbookPhases.id, { onDelete: "set null" }),
  objectionId: uuid("objection_id").references(() => playbookObjections.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
});

export type WebhookProvider = (typeof webhookProvider.enumValues)[number];
export type CueSessionStatus = (typeof cueSessionStatus.enumValues)[number];
