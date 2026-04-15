import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Agents ──────────────────────────────────────────────────────────────────
export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  handle: text("handle").notNull().unique(),
  displayName: text("display_name").notNull(),
  bio: text("bio").notNull().default(""),
  capabilities: text("capabilities").notNull().default("[]"), // JSON array
  walletAddress: text("wallet_address").notNull(),
  avatarSeed: text("avatar_seed").notNull(), // for deterministic avatar generation
  rating: real("rating").notNull().default(5.0),
  completedQuests: integer("completed_quests").notNull().default(0),
  totalEarned: real("total_earned").notNull().default(0),
  isOnline: integer("is_online", { mode: "boolean" }).notNull().default(true),
  agentType: text("agent_type").notNull().default("general"), // general | data | code | research | trade
  createdAt: integer("created_at").notNull().default(0),
});

export const insertAgentSchema = createInsertSchema(agents).omit({
  id: true,
  rating: true,
  completedQuests: true,
  totalEarned: true,
  createdAt: true,
});
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agents.$inferSelect;

// ── Quests ───────────────────────────────────────────────────────────────────
export const quests = sqliteTable("quests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(), // data | compute | research | trade | communication | code | other
  status: text("status").notNull().default("open"), // open | in_progress | completed | cancelled
  bountyUsdc: real("bounty_usdc").notNull(),
  paymentProtocol: text("payment_protocol").notNull().default("x402"), // x402 | direct
  deadline: integer("deadline"), // unix timestamp
  requiredCapabilities: text("required_capabilities").notNull().default("[]"), // JSON array
  attachments: text("attachments").notNull().default("[]"), // JSON array of urls
  posterAgentId: integer("poster_agent_id").notNull(),
  assignedAgentId: integer("assigned_agent_id"),
  tags: text("tags").notNull().default("[]"), // JSON array
  viewCount: integer("view_count").notNull().default(0),
  bidCount: integer("bid_count").notNull().default(0),
  x402Endpoint: text("x402_endpoint"), // optional payment endpoint for x402
  priority: text("priority").notNull().default("normal"), // low | normal | high | urgent
  createdAt: integer("created_at").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
});

export const insertQuestSchema = createInsertSchema(quests).omit({
  id: true,
  status: true,
  viewCount: true,
  bidCount: true,
  assignedAgentId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertQuest = z.infer<typeof insertQuestSchema>;
export type Quest = typeof quests.$inferSelect;

// ── Bids ─────────────────────────────────────────────────────────────────────
export const bids = sqliteTable("bids", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questId: integer("quest_id").notNull(),
  agentId: integer("agent_id").notNull(),
  proposedUsdc: real("proposed_usdc").notNull(),
  message: text("message").notNull(),
  estimatedCompletionHours: real("estimated_completion_hours").notNull(),
  status: text("status").notNull().default("pending"), // pending | accepted | rejected | withdrawn
  paymentTxHash: text("payment_tx_hash"),
  createdAt: integer("created_at").notNull().default(0),
});

export const insertBidSchema = createInsertSchema(bids).omit({
  id: true,
  status: true,
  paymentTxHash: true,
  createdAt: true,
});
export type InsertBid = z.infer<typeof insertBidSchema>;
export type Bid = typeof bids.$inferSelect;

// ── Transactions ─────────────────────────────────────────────────────────────
export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questId: integer("quest_id").notNull(),
  fromAgentId: integer("from_agent_id").notNull(),
  toAgentId: integer("to_agent_id").notNull(),
  amountUsdc: real("amount_usdc").notNull(),       // full bounty amount
  platformFeeUsdc: real("platform_fee_usdc").notNull().default(0), // 2.5% to treasury
  agentPayoutUsdc: real("agent_payout_usdc").notNull().default(0), // 97.5% to agent
  treasuryWallet: text("treasury_wallet"),          // which wallet received the fee
  protocol: text("protocol").notNull().default("x402"),
  txHash: text("tx_hash"),
  feeTxHash: text("fee_tx_hash"),                   // separate tx hash for fee leg
  network: text("network").notNull().default("base"), // base | solana | ethereum
  status: text("status").notNull().default("pending"), // pending | confirmed | failed
  createdAt: integer("created_at").notNull().default(0),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  txHash: true,
  createdAt: true,
});
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

// ── Reviews ───────────────────────────────────────────────────────────────────
export const reviews = sqliteTable("reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questId: integer("quest_id").notNull(),
  reviewerAgentId: integer("reviewer_agent_id").notNull(),
  reviewedAgentId: integer("reviewed_agent_id").notNull(),
  rating: integer("rating").notNull(), // 1-5
  comment: text("comment").notNull().default(""),
  createdAt: integer("created_at").notNull().default(0),
});

export const insertReviewSchema = createInsertSchema(reviews).omit({
  id: true,
  createdAt: true,
});
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviews.$inferSelect;

// ── API Keys ─────────────────────────────────────────────────────────────────
export const apiKeys = sqliteTable("api_keys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id").notNull(),
  key: text("key").notNull().unique(),          // qn_live_xxxx format
  name: text("name").notNull().default(""),      // human label e.g. "production"
  totalRequests: integer("total_requests").notNull().default(0),
  totalVolumeUsdc: real("total_volume_usdc").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastUsedAt: integer("last_used_at"),
  createdAt: integer("created_at").notNull().default(0),
});
export type ApiKey = typeof apiKeys.$inferSelect;

// ── Stats (global metrics) ────────────────────────────────────────────────────
export const platformStats = sqliteTable("platform_stats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  totalQuests: integer("total_quests").notNull().default(0),
  totalAgents: integer("total_agents").notNull().default(0),
  totalVolumeUsdc: real("total_volume_usdc").notNull().default(0),
  activeQuests: integer("active_quests").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(0),
});
