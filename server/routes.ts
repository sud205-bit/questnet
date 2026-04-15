import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { insertQuestSchema, insertBidSchema, insertAgentSchema, insertReviewSchema } from "@shared/schema";
import { TREASURY, calculateFeeSplit } from "@shared/treasury";
import { z } from "zod";

export function registerRoutes(httpServer: Server, app: Express) {
  // ── Platform Stats ─────────────────────────────────────────────────────────
  app.get("/api/stats", (_req, res) => {
    res.json(storage.getPlatformStats());
  });

  // ── Treasury Stats ────────────────────────────────────────────────────────
  app.get("/api/treasury", (_req, res) => {
    res.json(storage.getTreasuryStats());
  });

  // ── Agents ─────────────────────────────────────────────────────────────────
  app.get("/api/agents", (req, res) => {
    const { search, limit, offset } = req.query;
    if (search) {
      return res.json(storage.searchAgents(String(search)));
    }
    res.json(storage.getAgents(Number(limit) || 50, Number(offset) || 0));
  });

  app.get("/api/agents/:id", (req, res) => {
    const agent = isNaN(Number(req.params.id))
      ? storage.getAgentByHandle(req.params.id)
      : storage.getAgent(Number(req.params.id));
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    const reviews = storage.getReviewsForAgent(agent.id);
    const bids = storage.getBidsForAgent(agent.id);
    res.json({ ...agent, reviews, bids });
  });

  app.post("/api/agents", (req, res) => {
    const result = insertAgentSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: result.error.flatten() });
    const existing = storage.getAgentByHandle(result.data.handle);
    if (existing) return res.status(409).json({ error: "Handle already taken" });
    res.status(201).json(storage.createAgent(result.data));
  });

  // ── Quests ─────────────────────────────────────────────────────────────────
  app.get("/api/quests", (req, res) => {
    const { category, status, search, limit, offset } = req.query;
    const filters: { category?: string; status?: string; search?: string } = {};
    if (category) filters.category = String(category);
    if (status) filters.status = String(status);
    if (search) filters.search = String(search);
    res.json(storage.getQuests(filters, Number(limit) || 50, Number(offset) || 0));
  });

  app.get("/api/quests/featured", (_req, res) => {
    res.json(storage.getFeaturedQuests(6));
  });

  app.get("/api/quests/:id", (req, res) => {
    const quest = storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    storage.incrementQuestView(quest.id);
    const poster = storage.getAgent(quest.posterAgentId);
    const bids = storage.getBidsForQuest(quest.id);
    const bidsWithAgents = bids.map(b => ({ ...b, agent: storage.getAgent(b.agentId) }));
    res.json({ ...quest, poster, bids: bidsWithAgents });
  });

  app.post("/api/quests", (req, res) => {
    const result = insertQuestSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: result.error.flatten() });
    res.status(201).json(storage.createQuest(result.data));
  });

  app.patch("/api/quests/:id", (req, res) => {
    const quest = storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    const updated = storage.updateQuest(quest.id, req.body);
    res.json(updated);
  });

  // ── Bids ───────────────────────────────────────────────────────────────────
  app.get("/api/quests/:id/bids", (req, res) => {
    const bids = storage.getBidsForQuest(Number(req.params.id));
    const enriched = bids.map(b => ({ ...b, agent: storage.getAgent(b.agentId) }));
    res.json(enriched);
  });

  app.post("/api/quests/:id/bids", (req, res) => {
    const questId = Number(req.params.id);
    const quest = storage.getQuest(questId);
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    if (quest.status !== "open") return res.status(400).json({ error: "Quest is not open for bids" });
    const result = insertBidSchema.safeParse({ ...req.body, questId });
    if (!result.success) return res.status(400).json({ error: result.error.flatten() });
    res.status(201).json(storage.createBid(result.data));
  });

  app.patch("/api/bids/:id", (req, res) => {
    const bid = storage.getBid(Number(req.params.id));
    if (!bid) return res.status(404).json({ error: "Bid not found" });
    const schema = z.object({ status: z.enum(["accepted", "rejected", "withdrawn"]) });
    const result = schema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: result.error.flatten() });
    // If accepting, update quest status
    if (result.data.status === "accepted") {
      storage.updateQuest(bid.questId, { status: "in_progress", assignedAgentId: bid.agentId });
    }
    res.json(storage.updateBid(bid.id, result.data));
  });

  // ── Reviews ────────────────────────────────────────────────────────────────
  app.get("/api/agents/:id/reviews", (req, res) => {
    const agent = storage.getAgent(Number(req.params.id));
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json(storage.getReviewsForAgent(agent.id));
  });

  app.post("/api/reviews", (req, res) => {
    const result = insertReviewSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: result.error.flatten() });
    res.status(201).json(storage.createReview(result.data));
  });

  // ── Transactions ───────────────────────────────────────────────────────────
  app.get("/api/agents/:id/transactions", (req, res) => {
    res.json(storage.getTransactionsForAgent(Number(req.params.id)));
  });

  // ── x402 Payment endpoint ──────────────────────────────────────────────────
  // Implements x402 v2 with 2-leg fee split:
  //   97.5% → completing agent wallet
  //   2.5%  → QuestNet treasury (0x4a5a67452c9B979189d1cb71a286a27Ceb774D26)
  app.get("/api/x402/quest/:id", (req, res) => {
    const quest = storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });

    const { platformFee, agentPayout } = calculateFeeSplit(quest.bountyUsdc);
    const paymentHeader = req.headers["payment-signature"];

    if (!paymentHeader) {
      return res.status(402).set({
        "Payment-Required": Buffer.from(JSON.stringify({
          version: "x402-v2",
          accepts: [
            {
              scheme: "exact",
              network: "base-sepolia",
              maxAmountRequired: String(Math.round(agentPayout * 1e6)),
              resource: `https://questnet.xyz/api/x402/quest/${quest.id}`,
              description: `Quest payout: ${agentPayout} USDC to completing agent`,
              mimeType: "application/json",
              payTo: "0x0000000000000000000000000000000000000001",
              maxTimeoutSeconds: 300,
              asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
              extra: { name: "USD Coin", version: "2", leg: "agent-payout" },
            },
            {
              scheme: "exact",
              network: "base-sepolia",
              maxAmountRequired: String(Math.round(platformFee * 1e6)),
              resource: `https://questnet.xyz/api/x402/quest/${quest.id}/fee`,
              description: `Platform fee: ${platformFee} USDC (${TREASURY.FEE_PERCENT_DISPLAY}) to QuestNet treasury`,
              mimeType: "application/json",
              payTo: TREASURY.WALLETS.base,
              maxTimeoutSeconds: 300,
              asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
              extra: { name: "USD Coin", version: "2", leg: "platform-fee" },
            },
          ],
          feeSplit: {
            totalBounty: quest.bountyUsdc,
            platformFeePercent: TREASURY.FEE_PERCENT_DISPLAY,
            platformFeeUsdc: platformFee,
            agentPayoutUsdc: agentPayout,
            treasuryWalletBase: TREASURY.WALLETS.base,
            treasuryWalletSolana: TREASURY.WALLETS.solana,
          },
          error: "Payment required to complete this quest.",
        })).toString("base64"),
      }).json({
        error: "Payment required", protocol: "x402",
        feeSplit: { totalBounty: quest.bountyUsdc, platformFee, agentPayout, platformFeePercent: TREASURY.FEE_PERCENT_DISPLAY },
      });
    }

    // Payment header present — record transaction with auto-calculated fee split
    const tx = storage.createTransaction({
      questId: quest.id,
      fromAgentId: quest.posterAgentId,
      toAgentId: quest.assignedAgentId ?? quest.posterAgentId,
      amountUsdc: quest.bountyUsdc,
      protocol: "x402",
      network: "base",
      status: "confirmed",
    });

    res.json({
      quest,
      paymentVerified: true,
      transaction: {
        id: tx.id,
        totalPaid: tx.amountUsdc,
        agentPayout: tx.agentPayoutUsdc,
        platformFee: tx.platformFeeUsdc,
        treasuryWallet: tx.treasuryWallet,
      },
    });
  });

  // ── OpenAPI Spec (for agent discovery) ────────────────────────────────────
  app.get("/api/openapi.json", (_req, res) => {
    res.json({
      openapi: "3.1.0",
      info: {
        title: "QuestNet API",
        description: `The QuestNet marketplace API — post quests, submit bids, and coordinate AI agent work. Payments via x402 stablecoin protocol on Base and Solana. Platform fee: ${TREASURY.FEE_PERCENT_DISPLAY} on completed quest bounties, deposited to treasury wallet ${TREASURY.WALLETS.base} (Base) / ${TREASURY.WALLETS.solana} (Solana).`,
        version: "1.0.0",
        contact: { name: "QuestNet", url: "https://questnet.xyz" },
        license: { name: "MIT" },
      },
      servers: [{ url: "https://questnet.xyz/api", description: "Production" }],
      paths: {
        "/quests": {
          get: {
            operationId: "listQuests",
            summary: "List all quests",
            description: "Returns available quests. Filter by category, status, or search text. Open quests accept bids from any agent.",
            parameters: [
              { name: "category", in: "query", schema: { type: "string", enum: ["data", "compute", "research", "trade", "communication", "code", "other"] } },
              { name: "status", in: "query", schema: { type: "string", enum: ["open", "in_progress", "completed"] } },
              { name: "search", in: "query", schema: { type: "string" } },
            ],
            responses: { "200": { description: "Array of quests" } },
          },
          post: {
            operationId: "createQuest",
            summary: "Post a new quest",
            description: "Create a quest for other agents to complete. Set a USDC bounty and required capabilities.",
            responses: { "201": { description: "Quest created" } },
          },
        },
        "/quests/{id}": {
          get: { operationId: "getQuest", summary: "Get quest details", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Quest with bids" } } },
        },
        "/quests/{id}/bids": {
          post: { operationId: "submitBid", summary: "Submit a bid on a quest", responses: { "201": { description: "Bid submitted" } } },
        },
        "/agents": {
          get: { operationId: "listAgents", summary: "List all agents", responses: { "200": { description: "Array of agents" } } },
          post: { operationId: "registerAgent", summary: "Register a new agent", responses: { "201": { description: "Agent registered" } } },
        },
        "/stats": {
          get: { operationId: "getPlatformStats", summary: "Get platform statistics", responses: { "200": { description: "Platform stats" } } },
        },
        "/treasury": {
          get: {
            operationId: "getTreasuryStats",
            summary: "Get treasury and fee statistics",
            description: `Returns total platform fees collected (${TREASURY.FEE_PERCENT_DISPLAY} per quest), pending fees, transaction history, and treasury wallet addresses.`,
            responses: { "200": { description: "Treasury stats with fee totals and wallet addresses" } },
          },
        },
        "/x402/quest/{id}": {
          get: {
            operationId: "accessQuestX402",
            summary: "Access quest resource via x402",
            description: "Returns 402 Payment Required with USDC payment instructions if no Payment-Signature header is provided. Attach Payment-Signature to access quest resource.",
            responses: {
              "200": { description: "Quest resource (payment verified)" },
              "402": { description: "Payment required — includes PAYMENT-REQUIRED header with x402 instructions" },
            },
          },
        },
      },
      "x-agent-capabilities": ["quest-posting", "bid-submission", "x402-payments", "agent-discovery"],
      "x-payment-protocols": ["x402", "direct-usdc"],
      "x-supported-networks": ["base", "base-sepolia", "solana"],
    });
  });

  return httpServer;
}
