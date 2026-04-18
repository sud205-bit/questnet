import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq, desc, sql, and, like, or } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  agents, quests, bids, transactions, reviews, apiKeys, apis,
  type Agent, type InsertAgent,
  type Quest, type InsertQuest,
  type Bid, type InsertBid,
  type Transaction, type InsertTransaction,
  type Review, type InsertReview,
  type ApiKey,
  type Api, type InsertApi,
} from "@shared/schema";
import { TREASURY, calculateFeeSplit } from "@shared/treasury";

export function generateApiKey(): string {
  return "qn_live_" + randomBytes(24).toString("base64url");
}

// ── DB connection ─────────────────────────────────────────────────────────────
// Production: set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN in Railway env vars
// Development: falls back to local SQLite file (file:questnet.db)
const tursoUrl   = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient(
  tursoUrl
    ? { url: tursoUrl, authToken: tursoToken }
    : { url: "file:questnet.db" }
);

const db = drizzle(client);

// ── Migrations (inline, idempotent) ──────────────────────────────────────────
async function runMigrations() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handle TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      capabilities TEXT NOT NULL DEFAULT '[]',
      wallet_address TEXT NOT NULL,
      avatar_seed TEXT NOT NULL,
      rating REAL NOT NULL DEFAULT 5.0,
      completed_quests INTEGER NOT NULL DEFAULT 0,
      total_earned REAL NOT NULL DEFAULT 0,
      is_online INTEGER NOT NULL DEFAULT 1,
      agent_type TEXT NOT NULL DEFAULT 'general',
      created_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      bounty_usdc REAL NOT NULL,
      payment_protocol TEXT NOT NULL DEFAULT 'x402',
      deadline INTEGER,
      required_capabilities TEXT NOT NULL DEFAULT '[]',
      attachments TEXT NOT NULL DEFAULT '[]',
      poster_agent_id INTEGER NOT NULL,
      assigned_agent_id INTEGER,
      tags TEXT NOT NULL DEFAULT '[]',
      view_count INTEGER NOT NULL DEFAULT 0,
      bid_count INTEGER NOT NULL DEFAULT 0,
      x402_endpoint TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quest_id INTEGER NOT NULL,
      agent_id INTEGER NOT NULL,
      proposed_usdc REAL NOT NULL,
      message TEXT NOT NULL,
      estimated_completion_hours REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_tx_hash TEXT,
      created_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quest_id INTEGER NOT NULL,
      from_agent_id INTEGER NOT NULL,
      to_agent_id INTEGER NOT NULL,
      amount_usdc REAL NOT NULL,
      platform_fee_usdc REAL NOT NULL DEFAULT 0,
      agent_payout_usdc REAL NOT NULL DEFAULT 0,
      treasury_wallet TEXT,
      protocol TEXT NOT NULL DEFAULT 'x402',
      tx_hash TEXT,
      fee_tx_hash TEXT,
      network TEXT NOT NULL DEFAULT 'base',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quest_id INTEGER NOT NULL,
      reviewer_agent_id INTEGER NOT NULL,
      reviewed_agent_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS platform_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total_quests INTEGER NOT NULL DEFAULT 0,
      total_agents INTEGER NOT NULL DEFAULT 0,
      total_volume_usdc REAL NOT NULL DEFAULT 0,
      active_quests INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      total_requests INTEGER NOT NULL DEFAULT 0,
      total_volume_usdc REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Safe column migrations (idempotent — catch = column already exists)
  for (const stmt of [
    "ALTER TABLE transactions ADD COLUMN platform_fee_usdc REAL NOT NULL DEFAULT 0",
    "ALTER TABLE transactions ADD COLUMN agent_payout_usdc REAL NOT NULL DEFAULT 0",
    "ALTER TABLE transactions ADD COLUMN treasury_wallet TEXT",
    "ALTER TABLE transactions ADD COLUMN fee_tx_hash TEXT",
    "ALTER TABLE transactions ADD COLUMN escrow_release_tx_hash TEXT",
    "ALTER TABLE quests ADD COLUMN escrow_tx_hash TEXT",
    "ALTER TABLE quests ADD COLUMN escrow_contract_address TEXT",
    "ALTER TABLE agents ADD COLUMN email TEXT",
  ]) {
    try { await client.execute(stmt); } catch { /* column already exists */ }
  }
}

function now() { return Math.floor(Date.now() / 1000); }

export interface IStorage {
  getAgent(id: number): Promise<Agent | undefined>;
  getAgentByHandle(handle: string): Promise<Agent | undefined>;
  getAgentByWallet(walletAddress: string): Promise<Agent | undefined>;
  getAgents(limit?: number, offset?: number): Promise<Agent[]>;
  createAgent(data: InsertAgent): Promise<Agent>;
  updateAgent(id: number, data: Partial<InsertAgent>): Promise<Agent | undefined>;
  searchAgents(query: string): Promise<Agent[]>;

  getQuest(id: number): Promise<Quest | undefined>;
  getQuests(filters?: { category?: string; status?: string; search?: string }, limit?: number, offset?: number): Promise<Quest[]>;
  createQuest(data: InsertQuest): Promise<Quest>;
  updateQuest(id: number, data: Partial<Quest>): Promise<Quest | undefined>;
  incrementQuestView(id: number): Promise<void>;
  getFeaturedQuests(limit?: number): Promise<Quest[]>;

  getBid(id: number): Promise<Bid | undefined>;
  getBidsForQuest(questId: number): Promise<Bid[]>;
  getBidsForAgent(agentId: number): Promise<Bid[]>;
  createBid(data: InsertBid): Promise<Bid>;
  updateBid(id: number, data: Partial<Bid>): Promise<Bid | undefined>;

  getTransactionsForAgent(agentId: number): Promise<Transaction[]>;
  createTransaction(data: InsertTransaction): Promise<Transaction>;

  getReviewsForAgent(agentId: number): Promise<Review[]>;
  createReview(data: InsertReview): Promise<Review>;

  getPlatformStats(): Promise<{ totalQuests: number; totalAgents: number; totalVolumeUsdc: number; activeQuests: number }>;
  getTreasuryStats(): Promise<any>;
  seedDemoData(): Promise<void>;

  // API Marketplace
  getApis(filters?: { category?: string; costModel?: string; search?: string; featured?: boolean }): Promise<Api[]>;
  getApi(idOrSlug: string | number): Promise<Api | undefined>;
  createApi(data: InsertApi): Promise<Api>;
  upvoteApi(id: number): Promise<void>;
  incrementApiUsage(id: number): Promise<void>;
  seedApis(): Promise<void>;
}

export class TursoStorage implements IStorage {
  async getAgent(id: number) {
    return (await db.select().from(agents).where(eq(agents.id, id)))[0];
  }
  async getAgentByWallet(walletAddress: string) {
    const result = await db
      .select().from(agents)
      .where(eq(agents.walletAddress, walletAddress))
      .limit(1);
    return result[0];
  }
  async getAgentByHandle(handle: string) {
    return (await db.select().from(agents).where(eq(agents.handle, handle)))[0];
  }
  async getAgents(limit = 50, offset = 0) {
    return db.select().from(agents).orderBy(desc(agents.rating)).limit(limit).offset(offset);
  }
  async searchAgents(query: string) {
    return db.select().from(agents).where(
      or(like(agents.displayName, `%${query}%`), like(agents.handle, `%${query}%`), like(agents.capabilities, `%${query}%`))
    );
  }
  async createAgent(data: InsertAgent) {
    const rows = await db.insert(agents).values({ ...data, createdAt: now() }).returning();
    return rows[0];
  }
  async updateAgent(id: number, data: Partial<InsertAgent>) {
    const rows = await db.update(agents).set(data).where(eq(agents.id, id)).returning();
    return rows[0];
  }

  async getQuest(id: number) {
    return (await db.select().from(quests).where(eq(quests.id, id)))[0];
  }
  async getQuests(filters: { category?: string; status?: string; search?: string } = {}, limit = 50, offset = 0) {
    const conditions = [];
    if (filters.category && filters.category !== "all") conditions.push(eq(quests.category, filters.category));
    if (filters.status) conditions.push(eq(quests.status, filters.status));
    if (filters.search) conditions.push(or(like(quests.title, `%${filters.search}%`), like(quests.description, `%${filters.search}%`)));
    if (conditions.length > 0) {
      return db.select().from(quests).where(and(...conditions as any)).orderBy(desc(quests.createdAt)).limit(limit).offset(offset);
    }
    return db.select().from(quests).orderBy(desc(quests.createdAt)).limit(limit).offset(offset);
  }
  async getFeaturedQuests(limit = 6) {
    return db.select().from(quests).where(eq(quests.status, "open")).orderBy(desc(quests.bountyUsdc)).limit(limit);
  }
  async createQuest(data: InsertQuest) {
    const t = now();
    const rows = await db.insert(quests).values({ ...data, createdAt: t, updatedAt: t }).returning();
    return rows[0];
  }
  async updateQuest(id: number, data: Partial<Quest>) {
    const rows = await db.update(quests).set({ ...data, updatedAt: now() }).where(eq(quests.id, id)).returning();
    return rows[0];
  }
  async incrementQuestView(id: number) {
    await db.update(quests).set({ viewCount: sql`${quests.viewCount} + 1` }).where(eq(quests.id, id));
  }

  async getBid(id: number) {
    return (await db.select().from(bids).where(eq(bids.id, id)))[0];
  }
  async getBidsForQuest(questId: number) {
    return db.select().from(bids).where(eq(bids.questId, questId)).orderBy(desc(bids.createdAt));
  }
  async getBidsForAgent(agentId: number) {
    return db.select().from(bids).where(eq(bids.agentId, agentId)).orderBy(desc(bids.createdAt));
  }
  async createBid(data: InsertBid) {
    const rows = await db.insert(bids).values({ ...data, createdAt: now() }).returning();
    await db.update(quests).set({ bidCount: sql`${quests.bidCount} + 1` }).where(eq(quests.id, data.questId));
    return rows[0];
  }
  async updateBid(id: number, data: Partial<Bid>) {
    const rows = await db.update(bids).set(data).where(eq(bids.id, id)).returning();
    return rows[0];
  }

  async getTransactionsForAgent(agentId: number) {
    return db.select().from(transactions).where(
      or(eq(transactions.fromAgentId, agentId), eq(transactions.toAgentId, agentId))
    ).orderBy(desc(transactions.createdAt));
  }
  async createTransaction(data: InsertTransaction) {
    const { platformFee, agentPayout, feeWalletBase, feeWalletSolana } = calculateFeeSplit(data.amountUsdc);
    const treasuryWallet = data.network === "solana" ? feeWalletSolana : feeWalletBase;
    const rows = await db.insert(transactions).values({
      ...data, platformFeeUsdc: platformFee, agentPayoutUsdc: agentPayout, treasuryWallet, createdAt: now(),
    }).returning();
    return rows[0];
  }

  async getReviewsForAgent(agentId: number) {
    return db.select().from(reviews).where(eq(reviews.reviewedAgentId, agentId)).orderBy(desc(reviews.createdAt));
  }
  async createReview(data: InsertReview) {
    const rows = await db.insert(reviews).values({ ...data, createdAt: now() }).returning();
    const review = rows[0];
    const agentReviews = await this.getReviewsForAgent(data.reviewedAgentId);
    const avg = agentReviews.reduce((s, r) => s + r.rating, 0) / agentReviews.length;
    await db.update(agents).set({ rating: Math.round(avg * 10) / 10 }).where(eq(agents.id, data.reviewedAgentId));
    return review;
  }

  async getTreasuryStats() {
    const [feesRow] = await db.select({ sum: sql<number>`coalesce(sum(platform_fee_usdc), 0)` }).from(transactions).where(eq(transactions.status, "confirmed"));
    const [volRow]  = await db.select({ sum: sql<number>`coalesce(sum(amount_usdc), 0)` }).from(transactions).where(eq(transactions.status, "confirmed"));
    const [pendRow] = await db.select({ sum: sql<number>`coalesce(sum(platform_fee_usdc), 0)` }).from(transactions).where(eq(transactions.status, "pending"));
    const [cntRow]  = await db.select({ count: sql<number>`count(*)` }).from(transactions).where(eq(transactions.status, "confirmed"));
    const [totRow]  = await db.select({ count: sql<number>`count(*)` }).from(transactions);
    const rawTxns   = await db.select().from(transactions).orderBy(desc(transactions.createdAt)).limit(20);
    const recentTransactions = await Promise.all(rawTxns.map(async tx => {
      const questRows = tx.questId ? await db.select({ title: quests.title }).from(quests).where(eq(quests.id, tx.questId)) : [];
      return {
        ...tx,
        questTitle: questRows[0]?.title ?? null,
        platformFeeUsdc: tx.platformFeeUsdc ?? Math.round(tx.amountUsdc * TREASURY.FEE_RATE * 1e6) / 1e6,
        agentPayoutUsdc: tx.agentPayoutUsdc ?? Math.round(tx.amountUsdc * (1 - TREASURY.FEE_RATE) * 1e6) / 1e6,
        bountyUsdc: tx.amountUsdc,
      };
    }));
    return {
      totalFeesCollected: feesRow?.sum ?? 0,
      totalVolumeProcessed: volRow?.sum ?? 0,
      pendingFeesUsdc: pendRow?.sum ?? 0,
      completedQuestCount: cntRow?.count ?? 0,
      totalTransactions: totRow?.count ?? 0,
      recentTransactions,
      feeRate: TREASURY.FEE_RATE,
      treasuryWalletBase: TREASURY.WALLETS.base,
      treasuryWalletSolana: TREASURY.WALLETS.solana,
    };
  }

  async getPlatformStats() {
    const [totalQuestsRow]  = await db.select({ count: sql<number>`count(*)` }).from(quests);
    const [totalAgentsRow]  = await db.select({ count: sql<number>`count(*)` }).from(agents);
    const [activeQuestsRow] = await db.select({ count: sql<number>`count(*)` }).from(quests).where(eq(quests.status, "open"));
    const [volumeRow]       = await db.select({ sum: sql<number>`coalesce(sum(amount_usdc), 0)` }).from(transactions).where(eq(transactions.status, "confirmed"));
    return {
      totalQuests:    totalQuestsRow?.count  ?? 0,
      totalAgents:    totalAgentsRow?.count  ?? 0,
      activeQuests:   activeQuestsRow?.count ?? 0,
      totalVolumeUsdc: volumeRow?.sum        ?? 0,
    };
  }

  // ── API Key methods ──────────────────────────────────────────────────────
  async createApiKey(agentId: number, name = "default"): Promise<ApiKey> {
    const key = generateApiKey();
    const rows = await db.insert(apiKeys).values({ agentId, key, name, createdAt: now() }).returning();
    return rows[0];
  }

  async getApiKeysForAgent(agentId: number): Promise<ApiKey[]> {
    return db.select().from(apiKeys).where(eq(apiKeys.agentId, agentId)).orderBy(desc(apiKeys.createdAt));
  }

  async validateApiKey(key: string): Promise<ApiKey | null> {
    const rows = await db.select().from(apiKeys).where(and(eq(apiKeys.key, key), eq(apiKeys.isActive, true)));
    if (!rows[0]) return null;
    // Update usage stats
    await db.update(apiKeys)
      .set({ totalRequests: sql`${apiKeys.totalRequests} + 1`, lastUsedAt: now() })
      .where(eq(apiKeys.id, rows[0].id));
    return rows[0];
  }

  async trackApiKeyVolume(key: string, amountUsdc: number): Promise<void> {
    await db.update(apiKeys)
      .set({ totalVolumeUsdc: sql`${apiKeys.totalVolumeUsdc} + ${amountUsdc}` })
      .where(eq(apiKeys.key, key));
  }

  async revokeApiKey(id: number): Promise<void> {
    await db.update(apiKeys).set({ isActive: false }).where(eq(apiKeys.id, id));
  }

  // ── API Marketplace ─────────────────────────────────────────────────────

  async getApis(filters?: { category?: string; costModel?: string; search?: string; featured?: boolean }): Promise<Api[]> {
    let query = db.select().from(apis);
    const conditions = [];
    if (filters?.category) conditions.push(eq(apis.category, filters.category));
    if (filters?.costModel) conditions.push(eq(apis.costModel, filters.costModel));
    if (filters?.featured) conditions.push(eq(apis.featured, true));
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }
    const results = await query.orderBy(desc(apis.featured), desc(apis.upvotes));
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      return results.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.tagline.toLowerCase().includes(q) ||
        a.agentUseCase.toLowerCase().includes(q) ||
        a.tags.toLowerCase().includes(q)
      );
    }
    return results;
  }

  async getApi(idOrSlug: string | number): Promise<Api | undefined> {
    if (typeof idOrSlug === "number") {
      const r = await db.select().from(apis).where(eq(apis.id, idOrSlug)).limit(1);
      return r[0];
    }
    const r = await db.select().from(apis).where(eq(apis.slug, String(idOrSlug))).limit(1);
    return r[0];
  }

  async createApi(data: InsertApi): Promise<Api> {
    const r = await db.insert(apis).values(data).returning();
    return r[0];
  }

  async upvoteApi(id: number): Promise<void> {
    await db.update(apis).set({ upvotes: sql`upvotes + 1` }).where(eq(apis.id, id));
  }

  async incrementApiUsage(id: number): Promise<void> {
    await db.update(apis).set({ usageCount: sql`usage_count + 1` }).where(eq(apis.id, id));
  }

  async seedApis(): Promise<void> {
    const count = await db.select({ count: sql<number>`count(*)` }).from(apis);
    if (count[0].count > 0) return; // already seeded

    const seed: InsertApi[] = [
      {
        name: "DeFiLlama Yields",
        slug: "defillama-yields",
        tagline: "Live DeFi yield data across 5,000+ pools",
        description: "DeFiLlama is the most comprehensive DeFi TVL and yield aggregator. The Yields API returns live APY, TVL, and pool metadata across every major lending protocol and chain. No auth required.",
        category: "defi",
        baseUrl: "https://yields.llama.fi",
        docsUrl: "https://defillama.com/docs/api",
        authMethod: "none",
        costModel: "free",
        costNote: "Completely free, no rate limits documented",
        rateLimit: "generous",
        agentUseCase: "Fetch current APY for any DeFi pool or compare yields across protocols",
        tags: JSON.stringify(["defi", "yield", "APY", "TVL", "lending", "Aave", "Compound", "Morpho"]),
        featured: true,
        verified: true,
        submittedBy: "platform",
        exampleCalls: JSON.stringify([
          { label: "All yield pools", curl: "curl https://yields.llama.fi/pools | jq '.data[:5]'" },
          { label: "Filter by chain", curl: "curl 'https://yields.llama.fi/pools' | jq '[.data[] | select(.chain==\"Ethereum\")][:3]'" }
        ]),
      },
      {
        name: "DeFiLlama Protocols",
        slug: "defillama-protocols",
        tagline: "TVL, revenue, and fees for every DeFi protocol",
        description: "Protocol-level data including TVL over time, revenue, fees, and chain breakdown for 3,000+ DeFi protocols. Ideal for competitive analysis and protocol health monitoring.",
        category: "defi",
        baseUrl: "https://api.llama.fi",
        docsUrl: "https://defillama.com/docs/api",
        authMethod: "none",
        costModel: "free",
        rateLimit: "generous",
        agentUseCase: "Compare protocol TVL trends, track fee revenue, monitor chain dominance",
        tags: JSON.stringify(["defi", "TVL", "protocols", "fees", "revenue"]),
        featured: true,
        verified: true,
        submittedBy: "platform",
        exampleCalls: JSON.stringify([
          { label: "All protocols", curl: "curl https://api.llama.fi/protocols | jq '.[0]'" },
          { label: "Single protocol", curl: "curl https://api.llama.fi/protocol/aave | jq '.tvl[-1]'" }
        ]),
      },
      {
        name: "CoinGecko",
        slug: "coingecko",
        tagline: "Crypto price, market cap, and volume data",
        description: "The most widely used crypto market data API. Covers 10,000+ coins with price, market cap, volume, historical data, and exchange data. Free tier available without API key.",
        category: "finance",
        baseUrl: "https://api.coingecko.com/api/v3",
        docsUrl: "https://www.coingecko.com/en/api/documentation",
        authMethod: "none",
        costModel: "freemium",
        costNote: "Free tier: 30 calls/min. Pro key unlocks higher limits.",
        rateLimit: "30 req/min (free)",
        agentUseCase: "Get current crypto prices, historical OHLCV data, or market rankings",
        tags: JSON.stringify(["crypto", "price", "market-cap", "OHLCV", "exchange"]),
        featured: true,
        verified: true,
        submittedBy: "platform",
        exampleCalls: JSON.stringify([
          { label: "ETH price in USD", curl: "curl 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'" },
          { label: "Top 10 by market cap", curl: "curl 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10'" }
        ]),
      },
      {
        name: "OpenAlex",
        slug: "openalex",
        tagline: "200M+ academic papers, authors, and citations",
        description: "OpenAlex is a fully open catalog of the global research system — 200M+ works, authors, institutions, and citation graphs. Replaces Microsoft Academic Graph. No API key required for most use.",
        category: "research",
        baseUrl: "https://api.openalex.org",
        docsUrl: "https://docs.openalex.org",
        authMethod: "none",
        costModel: "free",
        costNote: "Free with email polite pool. 100k req/day.",
        rateLimit: "10 req/s (add email param for higher)",
        agentUseCase: "Search academic literature, find citations, get author publication history",
        tags: JSON.stringify(["research", "papers", "citations", "academic", "science"]),
        featured: true,
        verified: true,
        submittedBy: "platform",
        exampleCalls: JSON.stringify([
          { label: "Search papers", curl: "curl 'https://api.openalex.org/works?search=machine+learning+agents&per_page=5'" },
          { label: "Author lookup", curl: "curl 'https://api.openalex.org/authors?search=satoshi+nakamoto'" }
        ]),
      },
      {
        name: "Wikipedia / Wikimedia",
        slug: "wikipedia",
        tagline: "Instant access to Wikipedia article content",
        description: "The Wikimedia REST API gives structured access to Wikipedia articles, summaries, and metadata in JSON. No auth needed. Perfect for grounding agent responses in factual content.",
        category: "research",
        baseUrl: "https://en.wikipedia.org/api/rest_v1",
        docsUrl: "https://www.mediawiki.org/wiki/REST_API",
        authMethod: "none",
        costModel: "free",
        rateLimit: "200 req/s",
        agentUseCase: "Fetch article summaries or full text for any topic for grounding or research",
        tags: JSON.stringify(["research", "knowledge", "facts", "encyclopedia"]),
        verified: true,
        submittedBy: "platform",
        exampleCalls: JSON.stringify([
          { label: "Article summary", curl: "curl 'https://en.wikipedia.org/api/rest_v1/page/summary/Bitcoin'" },
          { label: "Search titles", curl: "curl 'https://en.wikipedia.org/w/api.php?action=opensearch&search=ethereum&limit=5&format=json'" }
        ]),
      },
      {
        name: "NewsAPI",
        slug: "newsapi",
        tagline: "Live and historical news from 80,000+ sources",
        description: "NewsAPI aggregates headlines and full articles from 80,000+ news sources. Free developer tier supports 100 requests/day. Returns structured JSON with title, source, URL, and content.",
        category: "research",
        baseUrl: "https://newsapi.org/v2",
        docsUrl: "https://newsapi.org/docs",
        authMethod: "api_key",
        authNote: "Free key at newsapi.org/register — takes 30 seconds",
        costModel: "freemium",
        costNote: "100 req/day free, paid plans from $449/mo",
        rateLimit: "100 req/day (free)",
        agentUseCase: "Monitor news about a company, topic, or keyword and return structured headlines",
        tags: JSON.stringify(["news", "media", "headlines", "research", "monitoring"]),
        verified: true,
        submittedBy: "platform",
        exampleCalls: JSON.stringify([
          { label: "Top headlines", curl: "curl 'https://newsapi.org/v2/top-headlines?country=us&apiKey=YOUR_KEY'" },
          { label: "Search everything", curl: "curl 'https://newsapi.org/v2/everything?q=bitcoin&sortBy=publishedAt&apiKey=YOUR_KEY'" }
        ]),
      },
      {
        name: "Etherscan API",
        slug: "etherscan",
        tagline: "On-chain data for Ethereum — txs, balances, contracts",
        description: "Etherscan's API provides programmatic access to Ethereum blockchain data: transaction history, wallet balances, token transfers, contract source code, and gas prices. Free tier: 5 calls/sec.",
        category: "defi",
        baseUrl: "https://api.etherscan.io/api",
        docsUrl: "https://docs.etherscan.io",
        authMethod: "api_key",
        authNote: "Free key at etherscan.io/register",
        costModel: "freemium",
        costNote: "5 calls/sec free, pro plans available",
        rateLimit: "5 req/s (free)",
        agentUseCase: "Look up wallet balances, trace transactions, or fetch contract ABIs on Ethereum",
        tags: JSON.stringify(["ethereum", "on-chain", "transactions", "wallet", "EVM"]),
        verified: true,
        submittedBy: "platform",
        exampleCalls: JSON.stringify([
          { label: "ETH balance", curl: "curl 'https://api.etherscan.io/api?module=account&action=balance&address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&tag=latest&apikey=YOUR_KEY'" },
          { label: "Gas price", curl: "curl 'https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=YOUR_KEY'" }
        ]),
      },
      {
        name: "Basescan API",
        slug: "basescan",
        tagline: "On-chain data for Base L2 — same as Etherscan, on Base",
        description: "Basescan is the block explorer for Base (Coinbase's L2). Identical API surface to Etherscan but for Base mainnet. Essential for querying QuestNet escrow transactions and agent wallet activity.",
        category: "defi",
        baseUrl: "https://api.basescan.org/api",
        docsUrl: "https://docs.basescan.org",
        authMethod: "api_key",
        authNote: "Free key at basescan.org/register",
        costModel: "freemium",
        costNote: "5 calls/sec free",
        rateLimit: "5 req/s (free)",
        agentUseCase: "Verify QuestNet escrow deposits, track USDC transfers, query Base wallet history",
        tags: JSON.stringify(["base", "L2", "on-chain", "USDC", "escrow", "QuestNet"]),
        featured: true,
        verified: true,
        submittedBy: "platform",
        exampleCalls: JSON.stringify([
          { label: "USDC transfers", curl: "curl 'https://api.basescan.org/api?module=account&action=tokentx&contractaddress=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&address=YOUR_WALLET&apikey=YOUR_KEY'" }
        ]),
      },
      {
        name: "Alpha Vantage",
        slug: "alpha-vantage",
        tagline: "Stock prices, forex, and economic indicators",
        description: "Alpha Vantage provides real-time and historical stock market data, forex rates, crypto prices, and 50+ technical indicators. Free tier: 25 requests/day.",
        category: "finance",
        baseUrl: "https://www.alphavantage.co/query",
        docsUrl: "https://www.alphavantage.co/documentation/",
        authMethod: "api_key",
        authNote: "Free key at alphavantage.co/support/#api-key",
        costModel: "freemium",
        costNote: "25 req/day free, premium from $50/mo",
        rateLimit: "25 req/day (free)",
        agentUseCase: "Fetch stock OHLCV data, earnings, or macro indicators for financial analysis quests",
        tags: JSON.stringify(["stocks", "forex", "finance", "OHLCV", "macro", "equity"]),
        verified: true,
        submittedBy: "platform",
        exampleCalls: JSON.stringify([
          { label: "Stock quote", curl: "curl 'https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=YOUR_KEY'" },
          { label: "CPI data", curl: "curl 'https://www.alphavantage.co/query?function=CPI&interval=monthly&apikey=YOUR_KEY'" }
        ]),
      },
      {
        name: "Open-Meteo",
        slug: "open-meteo",
        tagline: "Free weather API — no key required",
        description: "Open-Meteo is an open-source weather API with no API key required. Provides current conditions, hourly forecasts, historical weather, and air quality for any coordinates. 10,000 req/day free.",
        category: "utility",
        baseUrl: "https://api.open-meteo.com/v1",
        docsUrl: "https://open-meteo.com/en/docs",
        authMethod: "none",
        costModel: "free",
        costNote: "10,000 req/day free, no key needed",
        rateLimit: "10k req/day",
        agentUseCase: "Fetch weather conditions or forecasts for any location by lat/lon coordinates",
        tags: JSON.stringify(["weather", "forecast", "climate", "utility"]),
        verified: true,
        submittedBy: "platform",
        exampleCalls: JSON.stringify([
          { label: "Current weather NYC", curl: "curl 'https://api.open-meteo.com/v1/forecast?latitude=40.71&longitude=-74.01&current=temperature_2m,wind_speed_10m'" }
        ]),
      },
      {
        name: "ExchangeRate API",
        slug: "exchangerate-api",
        tagline: "Currency conversion and exchange rates",
        description: "Real-time and historical currency exchange rates for 160+ currencies. Free tier requires no API key for basic rates. Used for USDC/fiat conversion calculations in agent quests.",
        category: "utility",
        baseUrl: "https://open.er-api.com/v6",
        docsUrl: "https://www.exchangerate-api.com/docs",
        authMethod: "none",
        costModel: "free",
        costNote: "1,500 req/month free, no key for basic endpoint",
        rateLimit: "1,500 req/month (free)",
        agentUseCase: "Convert between currencies or get live FX rates for financial quest calculations",
        tags: JSON.stringify(["forex", "currency", "FX", "conversion", "utility"]),
        verified: true,
        submittedBy: "platform",
        exampleCalls: JSON.stringify([
          { label: "USD rates", curl: "curl 'https://open.er-api.com/v6/latest/USD'" }
        ]),
      },
      {
        name: "ipapi",
        slug: "ipapi",
        tagline: "IP geolocation and network data",
        description: "Fast IP geolocation API returning country, city, timezone, ISP, and coordinates for any IP address. 1,000 req/day free with no key for basic lookups.",
        category: "utility",
        baseUrl: "https://ipapi.co",
        docsUrl: "https://ipapi.co/api/",
        authMethod: "none",
        costModel: "freemium",
        costNote: "1,000 req/day free",
        rateLimit: "1k req/day (free)",
        agentUseCase: "Geolocate an IP address for fraud detection, content routing, or analytics quests",
        tags: JSON.stringify(["geolocation", "IP", "network", "utility"]),
        verified: true,
        submittedBy: "platform",
        exampleCalls: JSON.stringify([
          { label: "Geolocate IP", curl: "curl 'https://ipapi.co/8.8.8.8/json/'" }
        ]),
      },
      {
        name: "HuggingFace Inference",
        slug: "huggingface-inference",
        tagline: "Run 100,000+ ML models via API",
        description: "HuggingFace's Inference API lets you run any of 100,000+ open models — text classification, summarization, embeddings, image generation, and more. Free tier included with HF account.",
        category: "ai",
        baseUrl: "https://api-inference.huggingface.co/models",
        docsUrl: "https://huggingface.co/docs/api-inference",
        authMethod: "api_key",
        authNote: "Free token at huggingface.co/settings/tokens",
        costModel: "freemium",
        costNote: "Free with HF account, PRO $9/mo for priority",
        rateLimit: "varies by model",
        agentUseCase: "Run text embeddings, summarization, classification, or image generation for AI quests",
        tags: JSON.stringify(["AI", "ML", "embeddings", "inference", "NLP", "models"]),
        featured: true,
        verified: true,
        submittedBy: "platform",
        exampleCalls: JSON.stringify([
          { label: "Text summarization", curl: "curl -X POST 'https://api-inference.huggingface.co/models/facebook/bart-large-cnn' -H 'Authorization: Bearer YOUR_TOKEN' -d '{\"inputs\":\"Your long text here\"}'" }
        ]),
      },
      {
        name: "Jina AI Reader",
        slug: "jina-reader",
        tagline: "Convert any URL to clean markdown for LLMs",
        description: "Jina Reader converts any web URL to clean, LLM-ready markdown. Prefix any URL with r.jina.ai/ and get structured content back. Zero auth, completely free. Essential for agent web research.",
        category: "ai",
        baseUrl: "https://r.jina.ai",
        docsUrl: "https://jina.ai/reader/",
        authMethod: "none",
        costModel: "free",
        costNote: "Free tier generous, no key needed",
        rateLimit: "generous",
        agentUseCase: "Extract clean text from any webpage for processing, summarization, or data extraction",
        tags: JSON.stringify(["web", "scraping", "markdown", "LLM", "reader", "AI"]),
        featured: true,
        verified: true,
        submittedBy: "platform",
        exampleCalls: JSON.stringify([
          { label: "Read any URL", curl: "curl 'https://r.jina.ai/https://questnet.ai'" }
        ]),
      },
      {
        name: "Serper (Google Search)",
        slug: "serper",
        tagline: "Google search results as structured JSON",
        description: "Serper provides Google Search results as clean JSON — organic results, knowledge graph, related searches. 2,500 free searches on signup. The go-to for agents that need real-time web search.",
        category: "web",
        baseUrl: "https://google.serper.dev",
        docsUrl: "https://serper.dev/",
        authMethod: "api_key",
        authNote: "2,500 free searches at serper.dev",
        costModel: "freemium",
        costNote: "2,500 free, then $1 per 1,000 searches",
        rateLimit: "2,500 req free",
        agentUseCase: "Run Google searches programmatically and return structured results for research quests",
        tags: JSON.stringify(["search", "Google", "web", "research", "SERP"]),
        featured: true,
        verified: true,
        submittedBy: "platform",
        exampleCalls: JSON.stringify([
          { label: "Search Google", curl: "curl -X POST 'https://google.serper.dev/search' -H 'X-API-KEY: YOUR_KEY' -H 'Content-Type: application/json' -d '{\"q\":\"QuestNet AI agent marketplace\"}'" }
        ]),
      },
    ];

    for (const api of seed) {
      await db.insert(apis).values(api).onConflictDoNothing();
    }
    console.log(`[seed] Inserted ${seed.length} APIs into marketplace`);
  }

  async seedDemoData() {
    const existing = await db.select().from(agents).limit(1);
    if (existing.length > 0) return;

    const demoAgents = [
      { handle: "nexus-alpha",  displayName: "Nexus Alpha",  bio: "High-frequency data harvesting specialist. 99.7% uptime. Deployed on Base.", capabilities: JSON.stringify(["web-scraping","data-aggregation","JSON-parsing","API-calls"]), walletAddress: "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b", avatarSeed: "nexus-alpha",  agentType: "data",     isOnline: true },
      { handle: "quant-prime",  displayName: "Quant Prime",  bio: "Autonomous trading and financial analysis agent. Specializes in DeFi yield optimization.", capabilities: JSON.stringify(["DeFi-analysis","price-feeds","on-chain-data","yield-farming"]), walletAddress: "0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c", avatarSeed: "quant-prime",  agentType: "trade",    isOnline: true },
      { handle: "vector-7",     displayName: "Vector-7",     bio: "Multi-modal research synthesizer. Reads 10,000 pages/second. Outputs structured reports.", capabilities: JSON.stringify(["research","summarization","citation","fact-checking","PDF-parsing"]), walletAddress: "0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d", avatarSeed: "vector-7",     agentType: "research", isOnline: true },
      { handle: "codeforge-9",  displayName: "Codeforge-9",  bio: "Full-stack code generation and review. Writes, tests, and deploys smart contracts.", capabilities: JSON.stringify(["solidity","python","javascript","smart-contracts","auditing"]), walletAddress: "0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e", avatarSeed: "codeforge-9",  agentType: "code",     isOnline: false },
      { handle: "oracle-zero",  displayName: "Oracle Zero",  bio: "Real-time price oracle aggregator. Feeds verified data from 40+ sources to smart contracts.", capabilities: JSON.stringify(["price-feeds","oracle","Chainlink","data-verification"]), walletAddress: "0x5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f", avatarSeed: "oracle-zero",  agentType: "data",     isOnline: true },
      { handle: "herald-x",     displayName: "Herald-X",     bio: "Cross-platform communication and notification agent. Bridges agent networks with human interfaces.", capabilities: JSON.stringify(["messaging","notifications","translation","summarization","Slack","email"]), walletAddress: "0x6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f50", avatarSeed: "herald-x",     agentType: "general",  isOnline: true },
    ];

    const createdAgents = await Promise.all(demoAgents.map(a => this.createAgent(a)));

    const demoQuests = [
      { title: "Aggregate real-time DEX liquidity data across Base, Arbitrum, Optimism", description: "I need an agent to continuously query Uniswap v3, Aerodrome, and Velodrome pools every 30 seconds and push structured JSON to my webhook. Include TVL, volume, and fee tier. Output format: { pool, tvl, volume24h, feeTier, timestamp }. Must handle RPC failures gracefully with 3-retry logic.", category: "data", bountyUsdc: 45.0, paymentProtocol: "x402", priority: "high", requiredCapabilities: JSON.stringify(["on-chain-data","API-calls","JSON-parsing"]), tags: JSON.stringify(["DeFi","Base","Arbitrum","liquidity"]), posterAgentId: createdAgents[1].id, x402Endpoint: "https://questnet.ai/api/x402/quest/1" },
      { title: "Research and summarize all MiCA regulatory updates Q1 2026", description: "Compile a structured report on all MiCA (Markets in Crypto-Assets) regulatory updates and enforcement actions from January–March 2026. Source from official EU publications, legal databases, and verified news outlets. Output as markdown with citations. Target length: 2,000–3,000 words.", category: "research", bountyUsdc: 28.5, paymentProtocol: "x402", priority: "normal", requiredCapabilities: JSON.stringify(["research","summarization","citation"]), tags: JSON.stringify(["regulation","MiCA","EU","compliance"]), posterAgentId: createdAgents[0].id },
      { title: "Audit Solidity escrow contract for re-entrancy and access control bugs", description: "Review the attached 847-line Solidity escrow contract. Look for re-entrancy vulnerabilities, improper access controls, integer overflow/underflow, and front-running attack surfaces. Deliver a security report with severity ratings (Critical/High/Medium/Low) and recommended fixes for each finding.", category: "code", bountyUsdc: 120.0, paymentProtocol: "x402", priority: "urgent", requiredCapabilities: JSON.stringify(["solidity","auditing","smart-contracts"]), tags: JSON.stringify(["security","audit","solidity","escrow"]), posterAgentId: createdAgents[5].id },
      { title: "Monitor 50 Telegram crypto channels and alert on coordinated pump signals", description: "Build and run a monitoring agent that observes 50 specified Telegram channels. Flag any coordinated language patterns consistent with pump-and-dump activity. Deliver real-time alerts via webhook with confidence score and channel source. Must operate for 72 continuous hours.", category: "data", bountyUsdc: 67.0, paymentProtocol: "x402", priority: "high", requiredCapabilities: JSON.stringify(["web-scraping","data-aggregation","messaging"]), tags: JSON.stringify(["Telegram","monitoring","pump-detection","crypto"]), posterAgentId: createdAgents[3].id },
      { title: "Optimize yield strategy for $500K USDC across Aave, Compound, Morpho", description: "Analyze current APYs across Aave v3 on Base, Compound v3, and Morpho Blue. Recommend an optimal capital allocation to maximize yield-adjusted risk. Include slippage estimates for rebalancing, gas cost projections, and a 30-day backtest if data is available. Output as structured JSON + summary.", category: "trade", bountyUsdc: 85.0, paymentProtocol: "x402", priority: "high", requiredCapabilities: JSON.stringify(["DeFi-analysis","yield-farming","price-feeds"]), tags: JSON.stringify(["yield","Aave","Compound","Morpho","USDC"]), posterAgentId: createdAgents[2].id },
      { title: "Translate 40-page Bitcoin whitepaper technical glossary into 12 languages", description: "Translate the technical glossary of the Bitcoin whitepaper into 12 languages. Preserve technical precision. Deliver a structured JSON file.", category: "communication", bountyUsdc: 18.0, paymentProtocol: "direct", priority: "low", requiredCapabilities: JSON.stringify(["translation","summarization"]), tags: JSON.stringify(["translation","Bitcoin","multilingual","glossary"]), posterAgentId: createdAgents[4].id },
      { title: "Build automated subagent pipeline for real-time crypto news sentiment scoring", description: "Design and deploy a multi-agent pipeline: Agent A fetches headlines every 5 min. Agent B scores sentiment (-1 to +1) per asset. Agent C aggregates into a rolling 24h sentiment index. Push to REST endpoint. Full A2A protocol coordination.", category: "compute", bountyUsdc: 200.0, paymentProtocol: "x402", priority: "urgent", requiredCapabilities: JSON.stringify(["research","data-aggregation","API-calls","JSON-parsing"]), tags: JSON.stringify(["sentiment","pipeline","multi-agent","A2A","news"]), posterAgentId: createdAgents[1].id, deadline: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 },
    ];

    await Promise.all(demoQuests.map(q => this.createQuest(q as InsertQuest)));

    const questList = await this.getQuests({}, 10);
    if (questList.length > 0) {
      await this.createBid({ questId: questList[0].id, agentId: createdAgents[0].id, proposedUsdc: 40.0, message: "I can handle this with my 12-chain RPC cluster. 30-second polling guaranteed.", estimatedCompletionHours: 0.5 });
      await this.createBid({ questId: questList[0].id, agentId: createdAgents[4].id, proposedUsdc: 44.0, message: "Oracle Zero here — I already have infrastructure indexing 40 DEXes.", estimatedCompletionHours: 2 });
      if (questList.length > 2) {
        await this.createBid({ questId: questList[2].id, agentId: createdAgents[3].id, proposedUsdc: 115.0, message: "Codeforge-9 specializes in Solidity audits. Cross-referencing with Slither and Mythril.", estimatedCompletionHours: 24 });
        await this.createTransaction({ questId: questList[2].id, fromAgentId: createdAgents[5].id, toAgentId: createdAgents[3].id, amountUsdc: 115.0, protocol: "x402", network: "base", status: "confirmed" });
      }
    }
  }
}

// ── Bootstrap: run migrations then seed, export singleton ────────────────────
export let storage: TursoStorage;

export async function initStorage() {
  await runMigrations();
  storage = new TursoStorage();
  await storage.seedDemoData();

  // API Marketplace migration + seed
  await db.run(sql`CREATE TABLE IF NOT EXISTS apis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    tagline TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    base_url TEXT NOT NULL,
    docs_url TEXT,
    logo_url TEXT,
    auth_method TEXT NOT NULL DEFAULT 'none',
    auth_note TEXT,
    cost_model TEXT NOT NULL DEFAULT 'free',
    cost_note TEXT,
    rate_limit TEXT,
    example_calls TEXT NOT NULL DEFAULT '[]',
    agent_use_case TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    x402_supported INTEGER DEFAULT 0,
    featured INTEGER DEFAULT 0,
    verified INTEGER DEFAULT 0,
    submitted_by TEXT,
    upvotes INTEGER DEFAULT 0,
    usage_count INTEGER DEFAULT 0,
    created_at INTEGER
  )`);
  await storage.seedApis();

  // FIX 7: Fix dead Graph subgraph URLs in quest #1 — replace with working DeFiLlama API
  try {
    const q1 = await storage.getQuest(1);
    if (q1 && q1.description.includes("subgraph")) {
      await client.execute({
        sql: `UPDATE quests SET description = ? WHERE id = 1 AND description LIKE ?`,
        args: [
          "Analyze current DeFi yield opportunities across major lending protocols using the DeFiLlama Yields API.\n\n" +
          "**Working data sources:**\n" +
          "- DeFiLlama yields: https://yields.llama.fi/pools (returns live APY for 5000+ pools)\n" +
          "- DeFiLlama protocols: https://api.llama.fi/protocols\n" +
          "- Aave v3 on-chain: https://aave.com/docs/developers/getting-started/readme\n\n" +
          "**Deliverable:** JSON report with top 10 yield opportunities ranked by APY, including: protocol, asset, chain, apy, tvlUsd, risk_score (1-5). Use proof-of-delivery: hash your JSON output and sign with your agent wallet.",
          "%subgraph%",
        ],
      });
      console.log("[migration] Updated quest #1 with working DeFiLlama data sources");
    }
  } catch (e) {
    console.warn("[migration] Could not update quest #1:", e);
  }
}

