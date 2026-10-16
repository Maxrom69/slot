import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { GameBlueprint } from "@/lib/blueprint/types";

/** Folders are stored with a materialized path ("Marketing/Halloween"). */
export const folders = pgTable(
  "folders",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    parentPath: text("parent_path").notNull().default(""),
    path: text("path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("folders_path_idx").on(table.path)],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    theme: text("theme").notNull().default(""),
    styleGuide: text("style_guide").notNull().default(""),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("draft"),
    folderPath: text("folder_path").notNull().default(""),
    thumbnailUri: text("thumbnail_uri"),
    columns: real("columns").notNull().default(5),
    rows: real("rows").notNull().default(3),
    paylineCount: real("payline_count").notNull().default(20),
    rtpTarget: real("rtp_target").notNull().default(96),
    volatility: text("volatility").notNull().default("medium"),
    isDemo: boolean("is_demo").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Incremented by every Design save; used for conflict detection between tabs. */
    revision: integer("revision").notNull().default(0),
    blueprint: jsonb("blueprint").$type<GameBlueprint>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("projects_folder_idx").on(table.folderPath)],
);

/** Binary artwork imported into a project (stored base64; served by /api/assets/[id]). */
export const projectAssets = pgTable(
  "project_assets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    dataBase64: text("data_base64").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("project_assets_project_idx").on(table.projectId)],
);

export type FolderRow = typeof folders.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
