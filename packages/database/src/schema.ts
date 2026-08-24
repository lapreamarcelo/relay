import { sql as drizzleSql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: text("role").notNull().default("MEMBER"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("user_email_unique").on(table.email)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("session_token_unique").on(table.token), index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("account_provider_unique").on(table.providerId, table.accountId),
    index("account_user_id_idx").on(table.userId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const apiKey = pgTable(
  "api_key",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("api_key_hash_unique").on(table.keyHash), index("api_key_owner_created_idx").on(table.ownerId, table.createdAt)],
);

export const brand = pgTable(
  "brand",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    monogram: text("monogram").notNull(),
    color: text("color").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("brand_owner_id_idx").on(table.ownerId)],
);

export const socialAccount = pgTable(
  "social_account",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    brandId: text("brand_id").references(() => brand.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    authMethod: text("auth_method").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    refreshAfterAt: timestamp("refresh_after_at", { withTimezone: true }),
    grantedScopes: jsonb("granted_scopes").$type<string[]>().notNull().default([]),
    providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("connected"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    refreshLeaseOwner: text("refresh_lease_owner"),
    refreshLeaseExpiresAt: timestamp("refresh_lease_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("social_account_provider_unique").on(table.ownerId, table.provider, table.providerAccountId),
    index("social_account_owner_id_idx").on(table.ownerId),
    index("social_account_brand_id_idx").on(table.brandId),
    index("social_account_refresh_due_idx").on(table.refreshAfterAt),
  ],
);

export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    postId: text("post_id"),
    targetId: text("target_id"),
    provider: text("provider"),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    externalUrl: text("external_url"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_owner_event_unique").on(table.ownerId, table.eventKey),
    index("notification_owner_created_idx").on(table.ownerId, table.createdAt),
    index("notification_owner_unread_idx").on(table.ownerId, table.createdAt).where(drizzleSql`${table.readAt} IS NULL`),
  ],
);

export const relayPost = pgTable(
  "post",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    brandId: text("brand_id").references(() => brand.id, { onDelete: "set null" }),
    campaignId: text("campaign_id"),
    clientRequestId: text("client_request_id"),
    text: text("text").notNull(),
    mediaType: text("media_type").notNull().default("none"),
    mediaUrl: text("media_url"),
    mediaUrls: jsonb("media_urls").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("post_owner_created_idx").on(table.ownerId, table.createdAt),
    index("post_owner_scheduled_idx").on(table.ownerId, table.scheduledAt),
    index("post_owner_published_idx").on(table.ownerId, table.publishedAt),
    index("post_brand_id_idx").on(table.brandId),
    index("post_campaign_id_idx").on(table.campaignId),
    uniqueIndex("post_owner_client_request_unique").on(table.ownerId, table.clientRequestId).where(drizzleSql`${table.clientRequestId} IS NOT NULL`),
  ],
);

export const campaign = pgTable(
  "campaign",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    brandId: text("brand_id").references(() => brand.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#ff5c35"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("campaign_owner_updated_idx").on(table.ownerId, table.updatedAt), index("campaign_brand_id_idx").on(table.brandId)],
);

export const postTemplate = pgTable(
  "post_template",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    brandId: text("brand_id").references(() => brand.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    text: text("text").notNull().default(""),
    mediaType: text("media_type").notNull().default("none"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("post_template_owner_updated_idx").on(table.ownerId, table.updatedAt), index("post_template_brand_id_idx").on(table.brandId)],
);

export const slideshowProject = pgTable(
  "slideshow_project",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    brandId: text("brand_id").references(() => brand.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    caption: text("caption").notNull().default(""),
    slides: jsonb("slides").$type<Array<Record<string, unknown>>>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("slideshow_project_owner_updated_idx").on(table.ownerId, table.updatedAt), index("slideshow_project_brand_id_idx").on(table.brandId)],
);

export const videoProject = pgTable(
  "video_project",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    brandId: text("brand_id").references(() => brand.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    caption: text("caption").notNull().default(""),
    sourceUrl: text("source_url").notNull().default(""),
    sourceFolderId: text("source_folder_id"),
    musicUrl: text("music_url"),
    musicFolderId: text("music_folder_id"),
    labels: jsonb("labels").$type<Array<Record<string, unknown>>>().notNull().default([]),
    renderedUrl: text("rendered_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("video_project_owner_updated_idx").on(table.ownerId, table.updatedAt), index("video_project_brand_id_idx").on(table.brandId)],
);

export const analyticsReportSchedule = pgTable(
  "analytics_report_schedule",
  {
    id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }), name: text("name").notNull(), cadence: text("cadence").notNull(), filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}), nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(), lastSentAt: timestamp("last_sent_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("analytics_report_due_idx").on(table.nextRunAt)],
);

export const postTarget = pgTable(
  "post_target",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").notNull().references(() => relayPost.id, { onDelete: "cascade" }),
    socialAccountId: text("social_account_id").references(() => socialAccount.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    accountDisplayName: text("account_display_name").notNull(),
    accountHandle: text("account_handle").notNull(),
    status: text("status").notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    textOverride: text("text_override"),
    providerPostId: text("provider_post_id"),
    externalUrl: text("external_url"),
    error: text("error"),
    publishAttempts: integer("publish_attempts").notNull().default(0),
    publishAfter: timestamp("publish_after", { withTimezone: true }).notNull().defaultNow(),
    publishLeaseOwner: text("publish_lease_owner"),
    publishLeaseExpiresAt: timestamp("publish_lease_expires_at", { withTimezone: true }),
    analyticsAfter: timestamp("analytics_after", { withTimezone: true }),
    analyticsAttempts: integer("analytics_attempts").notNull().default(0),
    analyticsLastError: text("analytics_last_error"),
    analyticsLeaseOwner: text("analytics_lease_owner"),
    analyticsLeaseExpiresAt: timestamp("analytics_lease_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("post_target_post_id_idx").on(table.postId), index("post_target_social_account_id_idx").on(table.socialAccountId), index("post_target_publish_due_idx").on(table.publishAfter)],
);

export const workerHeartbeat = pgTable(
  "worker_heartbeat",
  {
    id: text("id").primaryKey(),
    workerId: text("worker_id").notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("worker_heartbeat_checked_idx").on(table.checkedAt)],
);

export const postMetricSnapshot = pgTable(
  "post_metric_snapshot",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id").notNull().references(() => postTarget.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    views: bigint("views", { mode: "number" }),
    reach: bigint("reach", { mode: "number" }),
    likes: bigint("likes", { mode: "number" }),
    comments: bigint("comments", { mode: "number" }),
    shares: bigint("shares", { mode: "number" }),
    saves: bigint("saves", { mode: "number" }),
    watchTimeSeconds: bigint("watch_time_seconds", { mode: "number" }),
    averageWatchTimeSeconds: integer("average_watch_time_seconds"),
    rawMetrics: jsonb("raw_metrics").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [index("post_metric_target_captured_idx").on(table.targetId, table.capturedAt)],
);

export const schema = { user, session, account, verification, apiKey, brand, socialAccount, notification, campaign, postTemplate, relayPost, slideshowProject, videoProject, analyticsReportSchedule, postTarget, postMetricSnapshot, workerHeartbeat };

export type RelayUser = typeof user.$inferSelect;
