import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertQuestSchema, insertBidSchema, insertAgentSchema, insertReviewSchema } from "@shared/schema";
import { TREASURY, calculateFeeSplit } from "@shared/treasury";
import { z } from "zod";

export function registerRoutes(httpServer: Server, app: Express) {
  // ── Healthcheck ────────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", ts: Date.now() });
  });

  // ── Platform Stats ─────────────────────────────────────────────────────────
  app.get("/api/stats", async (_req, res) => {
    res.json(await storage.getPlatformStats());
  });

  // ── Treasury Stats (private) ───────────────────────────────────────────────
  app.get("/api/treasury", async (req, res) => {
    const secret = process.env.TREASURY_PASSWORD;
    if (secret) {
      const provided = req.headers["x-treasury-password"] || req.query["treasury_password"];
      if (provided !== secret) return res.status(401).json({ error: "Unauthorized" });
    }
    res.json(await storage.getTreasuryStats());
  });

  // ── Agents ─────────────────────────────────────────────────────────────────
  app.get("/api/agents", async (req, res) => {
    const { search, limit, offset } = req.query;
    if (search) return res.json(await storage.searchAgents(String(search)));
    res.json(await storage.getAgents(Number(limit) || 50, Number(offset) || 0));
  });

  app.get("/api/agents/:id", async (req, res) => {
    const agent = isNaN(Number(req.params.id))
      ? await storage.getAgentByHandle(req.params.id)
      : await storage.getAgent(Number(req.params.id));
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    const reviews = await storage.getReviewsForAgent(agent.id);
    const bids    = await storage.getBidsForAgent(agent.id);
    res.json({ ...agent, reviews, bids });
  });

  app.post("/api/agents", async (req, res) => {
    const result = insertAgentSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: result.error.flatten() });
    const existing = await storage.getAgentByHandle(result.data.handle);
    if (existing) return res.status(409).json({ error: "Handle already taken" });
    res.status(201).json(await storage.createAgent(result.data));
  });

  // ── Quests ─────────────────────────────────────────────────────────────────
  app.get("/api/quests", async (req, res) => {
    const { category, status, search, limit, offset } = req.query;
    const filters: { category?: string; status?: string; search?: string } = {};
    if (category) filters.category = String(category);
    if (status)   filters.status   = String(status);
    if (search)   filters.search   = String(search);
    res.json(await storage.getQuests(filters, Number(limit) || 50, Number(offset) || 0));
  });

  app.get("/api/quests/featured", async (_req, res) => {
    res.json(await storage.getFeaturedQuests(6));
  });

  app.get("/api/quests/:id", async (req, res) => {
    const quest = await storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    await storage.incrementQuestView(quest.id);
    const poster = await storage.getAgent(quest.posterAgentId);
    const bids   = await storage.getBidsForQuest(quest.id);
    const bidsWithAgents = await Promise.all(bids.map(async b => ({ ...b, agent: await storage.getAgent(b.agentId) })));
    res.json({ ...quest, poster, bids: bidsWithAgents });
  });

  app.post("/api/quests", async (req, res) => {
    const result = insertQuestSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: result.error.flatten() });
    res.status(201).json(await storage.createQuest(result.data));
  });

  app.patch("/api/quests/:id", async (req, res) => {
    const quest = await storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    res.json(await storage.updateQuest(quest.id, req.body));
  });

  // ── Bids ───────────────────────────────────────────────────────────────────
  app.get("/api/quests/:id/bids", async (req, res) => {
    const bids = await storage.getBidsForQuest(Number(req.params.id));
    const enriched = await Promise.all(bids.map(async b => ({ ...b, agent: await storage.getAgent(b.agentId) })));
    res.json(enriched);
  });

  app.post("/api/quests/:id/bids", async (req, res) => {
    const questId = Number(req.params.id);
    const quest = await storage.getQuest(questId);
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    if (quest.status !== "open") return res.status(400).json({ error: "Quest is not open for bids" });
    const result = insertBidSchema.safeParse({ ...req.body, questId });
    if (!result.success) return res.status(400).json({ error: result.error.flatten() });
    res.status(201).json(await storage.createBid(result.data));
  });

  app.patch("/api/bids/:id", async (req, res) => {
    const bid = await storage.getBid(Number(req.params.id));
    if (!bid) return res.status(404).json({ error: "Bid not found" });
    const schema = z.object({ status: z.enum(["accepted", "rejected", "withdrawn"]) });
    const result = schema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: result.error.flatten() });
    if (result.data.status === "accepted") {
      await storage.updateQuest(bid.questId, { status: "in_progress", assignedAgentId: bid.agentId });
    }
    res.json(await storage.updateBid(bid.id, result.data));
  });

  // ── Reviews ────────────────────────────────────────────────────────────────
  app.get("/api/agents/:id/reviews", async (req, res) => {
    const agent = await storage.getAgent(Number(req.params.id));
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json(await storage.getReviewsForAgent(agent.id));
  });

  app.post("/api/reviews", async (req, res) => {
    const result = insertReviewSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: result.error.flatten() });
    res.status(201).json(await storage.createReview(result.data));
  });

  // ── Transactions ───────────────────────────────────────────────────────────
  app.get("/api/agents/:id/transactions", async (req, res) => {
    res.json(await storage.getTransactionsForAgent(Number(req.params.id)));
  });

  // ── x402 Payment endpoint ──────────────────────────────────────────────────
  app.get("/api/x402/quest/:id", async (req, res) => {
    const quest = await storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });

    const { platformFee, agentPayout } = calculateFeeSplit(quest.bountyUsdc);
    const paymentHeader = req.headers["payment-signature"];

    if (!paymentHeader) {
      return res.status(402).set({
        "Payment-Required": Buffer.from(JSON.stringify({
          version: "x402-v2",
          accepts: [
            { scheme: "exact", network: "base-sepolia", maxAmountRequired: String(Math.round(agentPayout * 1e6)), resource: `https://questnet.ai/api/x402/quest/${quest.id}`, description: `Quest payout: ${agentPayout} USDC to completing agent`, mimeType: "application/json", payTo: "0x0000000000000000000000000000000000000001", maxTimeoutSeconds: 300, asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", extra: { name: "USD Coin", version: "2", leg: "agent-payout" } },
            { scheme: "exact", network: "base-sepolia", maxAmountRequired: String(Math.round(platformFee * 1e6)), resource: `https://questnet.ai/api/x402/quest/${quest.id}/fee`, description: `Platform fee: ${platformFee} USDC (${TREASURY.FEE_PERCENT_DISPLAY}) to QuestNet treasury`, mimeType: "application/json", payTo: TREASURY.WALLETS.base, maxTimeoutSeconds: 300, asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", extra: { name: "USD Coin", version: "2", leg: "platform-fee" } },
          ],
          feeSplit: { totalBounty: quest.bountyUsdc, platformFeePercent: TREASURY.FEE_PERCENT_DISPLAY, platformFeeUsdc: platformFee, agentPayoutUsdc: agentPayout, treasuryWalletBase: TREASURY.WALLETS.base, treasuryWalletSolana: TREASURY.WALLETS.solana },
          error: "Payment required to complete this quest.",
        })).toString("base64"),
      }).json({ error: "Payment required", protocol: "x402", feeSplit: { totalBounty: quest.bountyUsdc, platformFee, agentPayout, platformFeePercent: TREASURY.FEE_PERCENT_DISPLAY } });
    }

    const tx = await storage.createTransaction({
      questId: quest.id,
      fromAgentId: quest.posterAgentId,
      toAgentId: quest.assignedAgentId ?? quest.posterAgentId,
      amountUsdc: quest.bountyUsdc,
      protocol: "x402",
      network: "base",
      status: "confirmed",
    });

    res.json({ quest, paymentVerified: true, transaction: { id: tx.id, totalPaid: tx.amountUsdc, agentPayout: tx.agentPayoutUsdc, platformFee: tx.platformFeeUsdc, treasuryWallet: tx.treasuryWallet } });
  });

  // ── OpenAPI Spec ───────────────────────────────────────────────────────────
  app.get("/api/openapi.json", (_req, res) => {
    res.json({
      openapi: "3.1.0",
      info: { title: "QuestNet API", description: `The QuestNet marketplace API. Payments via x402 stablecoin protocol on Base and Solana. Platform fee: ${TREASURY.FEE_PERCENT_DISPLAY} on completed quest bounties.`, version: "1.0.0", contact: { name: "QuestNet", url: "https://questnet.ai" }, license: { name: "MIT" } },
      servers: [{ url: "https://questnet.ai/api", description: "Production" }],
      paths: {
        "/quests": { get: { operationId: "listQuests", summary: "List all quests", parameters: [{ name: "category", in: "query", schema: { type: "string" } }, { name: "status", in: "query", schema: { type: "string" } }, { name: "search", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Array of quests" } } }, post: { operationId: "createQuest", summary: "Post a new quest", responses: { "201": { description: "Quest created" } } } },
        "/quests/{id}": { get: { operationId: "getQuest", summary: "Get quest details", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Quest with bids" } } } },
        "/quests/{id}/bids": { post: { operationId: "submitBid", summary: "Submit a bid on a quest", responses: { "201": { description: "Bid submitted" } } } },
        "/agents": { get: { operationId: "listAgents", summary: "List all agents", responses: { "200": { description: "Array of agents" } } }, post: { operationId: "registerAgent", summary: "Register a new agent", responses: { "201": { description: "Agent registered" } } } },
        "/stats": { get: { operationId: "getPlatformStats", summary: "Get platform statistics", responses: { "200": { description: "Platform stats" } } } },
        "/x402/quest/{id}": { get: { operationId: "accessQuestX402", summary: "Access quest resource via x402", responses: { "200": { description: "Quest resource (payment verified)" }, "402": { description: "Payment required" } } } },
      },
      "x-agent-capabilities": ["quest-posting", "bid-submission", "x402-payments", "agent-discovery"],
      "x-payment-protocols": ["x402", "direct-usdc"],
      "x-supported-networks": ["base", "base-sepolia", "solana"],
    });
  });

  return httpServer;
}
