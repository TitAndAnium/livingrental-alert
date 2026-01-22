import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table for potential future auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Preflight scan result types
export const preflightResultSchema = z.object({
  timestamp: z.string(),
  osInfo: z.object({
    distro: z.string(),
    kernel: z.string(),
    hostname: z.string(),
  }),
  ports: z.array(z.object({
    port: z.number(),
    protocol: z.string(),
    process: z.string(),
    state: z.string(),
  })),
  docker: z.object({
    installed: z.boolean(),
    version: z.string().optional(),
    composeVersion: z.string().optional(),
    containers: z.array(z.object({
      name: z.string(),
      image: z.string(),
      status: z.string(),
      ports: z.string(),
    })),
    networks: z.array(z.string()),
    volumes: z.array(z.string()),
  }),
  reverseProxy: z.object({
    detected: z.boolean(),
    type: z.enum(["nginx", "caddy", "traefik", "none"]),
    configPath: z.string().optional(),
  }),
  existingServices: z.object({
    n8n: z.boolean(),
    postgres: z.boolean(),
    ntfy: z.boolean(),
    playwright: z.boolean(),
  }),
  resources: z.object({
    diskFree: z.string(),
    diskTotal: z.string(),
    memoryFree: z.string(),
    memoryTotal: z.string(),
  }),
  safePlan: z.object({
    portsToUse: z.object({
      postgres: z.number(),
      n8n: z.number(),
      ntfy: z.number(),
      fetcher: z.number(),
    }),
    reuseExistingProxy: z.boolean(),
    proxyConfigSnippet: z.string().optional(),
    warnings: z.array(z.string()),
    readyToDeploy: z.boolean(),
  }),
});

export type PreflightResult = z.infer<typeof preflightResultSchema>;

// Deployment status types
export const deploymentStatusSchema = z.object({
  status: z.enum(["idle", "scanning", "deploying", "success", "error"]),
  message: z.string(),
  lastScan: z.string().optional(),
  lastDeploy: z.string().optional(),
  services: z.object({
    postgres: z.object({ running: z.boolean(), healthy: z.boolean() }),
    n8n: z.object({ running: z.boolean(), healthy: z.boolean(), url: z.string().optional() }),
    ntfy: z.object({ running: z.boolean(), healthy: z.boolean(), url: z.string().optional() }),
    fetcher: z.object({ running: z.boolean(), healthy: z.boolean(), url: z.string().optional() }),
  }).optional(),
});

export type DeploymentStatus = z.infer<typeof deploymentStatusSchema>;

// Fetcher request/response types
export const fetchRequestSchema = z.object({
  url: z.string().url(),
  mode: z.enum(["http", "browser"]),
  timeout: z.number().optional().default(30000),
  waitForSelector: z.string().optional(),
  screenshot: z.boolean().optional().default(false),
});

export type FetchRequest = z.infer<typeof fetchRequestSchema>;

export const fetchResponseSchema = z.object({
  status: z.number(),
  finalUrl: z.string(),
  html: z.string(),
  text: z.string(),
  fetchedAt: z.string(),
  durationMs: z.number(),
  screenshotBase64: z.string().optional(),
});

export type FetchResponse = z.infer<typeof fetchResponseSchema>;
