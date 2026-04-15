import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { parsePaymentHeader, verifyX402Payment } from "./x402";
import { insertQuestSchema, insertBidSchema, insertAgentSchema, insertReviewSchema } from "@shared/schema";
import { TREASURY, calculateFeeSplit } from "@shared/treasury";
import { ESCROW_ENABLED, ESCROW_ADDRESS, verifyEscrowDeposit, releaseEscrow, refundEscrow, getEscrowState } from "./escrow";
import { z } from "zod";

// ── API Key middleware ─────────────────────────────────────────────────────────
// Reads key from Authorization: Bearer qn_live_xxx  OR  X-Api-Key: qn_live_xxx
async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const keyHeader  = req.headers["x-api-key"] as string | undefined;
  let key: string | null = null;

  if (authHeader?.startsWith("Bearer ")) key = authHeader.slice(7);
  else if (keyHeader) key = keyHeader;

  if (!key) return res.status(401).json({ error: "API key required. Pass Authorization: Bearer qn_live_xxx or X-Api-Key header." });

  const apiKey = await storage.validateApiKey(key);
  if (!apiKey) return res.status(401).json({ error: "Invalid or revoked API key." });

  // Attach to request for downstream use
  (req as any).apiKey = apiKey;
  next();
}

export function registerRoutes(httpServer: Server, app: Express) {
  // ── Healthcheck ────────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", ts: Date.now() });
  });

  // ── Platform Stats (public) ────────────────────────────────────────────────
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

  // ── API Keys ───────────────────────────────────────────────────────────────
  // POST /api/agents/:id/keys  → create a new key for an agent
  app.post("/api/agents/:id/keys", async (req, res) => {
    const agent = await storage.getAgent(Number(req.params.id));
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    const { name } = req.body;
    const key = await storage.createApiKey(agent.id, name || "default");
    res.status(201).json({
      id: key.id,
      key: key.key,           // shown once — agent must save this
      name: key.name,
      agentId: key.agentId,
      createdAt: key.createdAt,
      message: "Save this key — it will not be shown again.",
    });
  });

  // GET /api/agents/:id/keys  → list keys for an agent (masked)
  app.get("/api/agents/:id/keys", async (req, res) => {
    const agent = await storage.getAgent(Number(req.params.id));
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    const keys = await storage.getApiKeysForAgent(agent.id);
    res.json(keys.map(k => ({
      ...k,
      key: k.key.slice(0, 12) + "••••••••••••",  // masked — never expose full key again
    })));
  });

  // DELETE /api/keys/:id  → revoke a key
  app.delete("/api/keys/:id", async (req, res) => {
    await storage.revokeApiKey(Number(req.params.id));
    res.json({ revoked: true });
  });

  // ── Agents (public read, key-protected write) ──────────────────────────────
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

  // Register agent → auto-generates an API key
  app.post("/api/agents", async (req, res) => {
    const result = insertAgentSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: result.error.flatten() });
    const existing = await storage.getAgentByHandle(result.data.handle);
    if (existing) return res.status(409).json({ error: "Handle already taken" });
    const agent = await storage.createAgent(result.data);
    // Auto-create first API key on registration
    const apiKey = await storage.createApiKey(agent.id, "default");
    res.status(201).json({
      agent,
      apiKey: {
        key: apiKey.key,    // shown once
        message: "Save this API key — it will not be shown again. Use it in Authorization: Bearer <key> or X-Api-Key headers.",
      },
    });
  });

  // ── Quests (public read, API key required for write) ──────────────────────
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

  // POST quest — requires API key
  // Optional: include { escrowDepositTxHash: "0x..." } in body to record on-chain escrow deposit
  app.post("/api/quests", requireApiKey, async (req, res) => {
    const result = insertQuestSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: result.error.flatten() });

    const quest = await storage.createQuest(result.data);

    // If escrow is enabled and poster provided a deposit tx hash, verify it on-chain
    const depositTxHash = req.body.escrowDepositTxHash as string | undefined;
    if (depositTxHash && ESCROW_ENABLED) {
      const verification = await verifyEscrowDeposit(quest.id, depositTxHash as `0x${string}`, quest.bountyUsdc);
      if (verification.ok) {
        await storage.updateQuest(quest.id, {
          escrowTxHash: depositTxHash,
          escrowContractAddress: ESCROW_ADDRESS,
        });
        return res.status(201).json({
          ...quest,
          escrowTxHash: depositTxHash,
          escrowContractAddress: ESCROW_ADDRESS,
          escrowVerified: true,
        });
      } else {
        // Deposit verification failed — still create the quest but flag it
        console.warn(`[escrow] Deposit verify failed for quest ${quest.id}:`, verification.error);
        return res.status(201).json({
          ...quest,
          escrowVerified: false,
          escrowWarning: verification.error,
        });
      }
    }

    // No escrow deposit provided — return quest with escrow payment instructions if enabled
    const escrowInfo = ESCROW_ENABLED ? {
      escrowContractAddress: ESCROW_ADDRESS,
      escrowRequired: true,
      escrowInstructions: {
        action: "Call deposit(questId, amount) on the QuestEscrow contract before quest goes live",
        contractAddress: ESCROW_ADDRESS,
        questId: quest.id,
        amountUsdc: quest.bountyUsdc,
        amountRaw: String(Math.round(quest.bountyUsdc * 1e6)),
        basescanLink: `https://basescan.org/address/${ESCROW_ADDRESS}`,
      },
    } : {};

    res.status(201).json({ ...quest, ...escrowInfo });
  });

  app.patch("/api/quests/:id", async (req, res) => {
    const quest = await storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    const updated = await storage.updateQuest(quest.id, req.body);
    res.json(updated);
  });

  // POST /api/quests/:id/cancel — cancel quest and refund escrow bounty to poster
  app.post("/api/quests/:id/cancel", requireApiKey, async (req, res) => {
    const quest = await storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    if (quest.status === "completed") return res.status(400).json({ error: "Quest already completed" });
    if (quest.status === "cancelled") return res.status(400).json({ error: "Quest already cancelled" });

    let refundResult: { success: boolean; txHash: string | null; error?: string } = { success: false, txHash: null };

    // Trigger on-chain refund if escrow deposit exists
    if (ESCROW_ENABLED && quest.escrowTxHash) {
      refundResult = await refundEscrow(quest.id);
      if (!refundResult.success) {
        console.warn(`[escrow] Refund failed for quest ${quest.id}: ${refundResult.error}`);
      }
    }

    await storage.updateQuest(quest.id, { status: "cancelled" });

    res.json({
      success: true,
      questId: quest.id,
      status: "cancelled",
      escrowRefunded: refundResult.success,
      escrowRefundTxHash: refundResult.txHash ?? null,
      ...(refundResult.error ? { escrowWarning: refundResult.error } : {}),
    });
  });

  // GET /api/quests/:id/escrow — read escrow state from the contract
  app.get("/api/quests/:id/escrow", async (req, res) => {
    const quest = await storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });

    if (!ESCROW_ENABLED) {
      return res.json({
        escrowEnabled: false,
        message: "Escrow contract not configured. Set ESCROW_CONTRACT_ADDRESS + RESOLVER_PRIVATE_KEY in Railway.",
      });
    }

    const state = await getEscrowState(quest.id);
    res.json({
      escrowEnabled: true,
      contractAddress: ESCROW_ADDRESS,
      questId: quest.id,
      escrowTxHash: quest.escrowTxHash ?? null,
      onChainState: state,
    });
  });

  // ── Bids (API key required for submit) ────────────────────────────────────
  app.get("/api/quests/:id/bids", async (req, res) => {
    const bids = await storage.getBidsForQuest(Number(req.params.id));
    const enriched = await Promise.all(bids.map(async b => ({ ...b, agent: await storage.getAgent(b.agentId) })));
    res.json(enriched);
  });

  app.post("/api/quests/:id/bids", requireApiKey, async (req, res) => {
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

  app.post("/api/reviews", requireApiKey, async (req, res) => {
    const result = insertReviewSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: result.error.flatten() });
    res.status(201).json(await storage.createReview(result.data));
  });

  // ── Transactions ───────────────────────────────────────────────────────────
  app.get("/api/agents/:id/transactions", async (req, res) => {
    res.json(await storage.getTransactionsForAgent(Number(req.params.id)));
  });

  // ── x402 — GET: return 402 challenge ──────────────────────────────────────
  // Returns payment instructions without requiring a key (agents need to discover this)
  app.get("/api/x402/quest/:id", async (req, res) => {
    const quest = await storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });

    const { platformFee, agentPayout } = calculateFeeSplit(quest.bountyUsdc);

    return res.status(402).set({
      "Payment-Required": Buffer.from(JSON.stringify({
        version: "x402-v2",
        accepts: [
          {
            scheme: "exact",
            network: "base",
            maxAmountRequired: String(Math.round(agentPayout * 1e6)),
            resource: `https://questnet.ai/api/x402/quest/${quest.id}/pay`,
            description: `Quest payout: ${agentPayout} USDC to completing agent`,
            mimeType: "application/json",
            payTo: "agent_wallet",   // agent fills in their own wallet
            maxTimeoutSeconds: 300,
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  // USDC on Base mainnet
            extra: { name: "USD Coin", version: "2", leg: "agent-payout" },
          },
          {
            scheme: "exact",
            network: "base",
            maxAmountRequired: String(Math.round(platformFee * 1e6)),
            resource: `https://questnet.ai/api/x402/quest/${quest.id}/pay`,
            description: `Platform fee: ${platformFee} USDC (${TREASURY.FEE_PERCENT_DISPLAY}) to QuestNet treasury`,
            mimeType: "application/json",
            payTo: TREASURY.WALLETS.base,
            maxTimeoutSeconds: 300,
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
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
        paymentEndpoint: `https://questnet.ai/api/x402/quest/${quest.id}/pay`,
        error: "Payment required to complete this quest.",
      })).toString("base64"),
    }).json({
      error: "Payment required",
      protocol: "x402-v2",
      quest: { id: quest.id, title: quest.title, bountyUsdc: quest.bountyUsdc },
      feeSplit: { totalBounty: quest.bountyUsdc, platformFee, agentPayout, platformFeePercent: TREASURY.FEE_PERCENT_DISPLAY },
    });
  });

  // ── x402 — POST: submit payment proof, verify on-chain, settle ────────────
  app.post("/api/x402/quest/:id/pay", requireApiKey, async (req, res) => {
    const quest = await storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    if (quest.status === "completed") return res.status(400).json({ error: "Quest already completed" });

    const apiKey = (req as any).apiKey;

    // Parse Payment-Signature header (base64 JSON) or request body
    const rawSig = req.headers["payment-signature"] as string || req.body?.paymentSignature;
    if (!rawSig) {
      return res.status(400).json({
        error: "Missing Payment-Signature header or paymentSignature body field.",
        format: "Base64-encoded JSON: { txHash, network, from, to, amountUsdc, questId }",
      });
    }

    const { parsePaymentHeader: parse, verifyX402Payment: verify } = await import("./x402");
    const sig = parse(rawSig);
    if (!sig) return res.status(400).json({ error: "Invalid Payment-Signature format" });

    // Get agent wallet for verification
    const assignedAgent = quest.assignedAgentId ? await storage.getAgent(quest.assignedAgentId) : null;
    const agentWallet = assignedAgent?.walletAddress || sig.to;

    // Verify on-chain (with DB fallback)
    const verification = await verify(sig, agentWallet, quest.bountyUsdc);

    let escrowReleaseTxHash: string | undefined;

    // ── Escrow release path ────────────────────────────────────────────────────
    // If the escrow contract is configured AND this quest has an escrow deposit,
    // use contract release() instead of relying on a manual USDC transfer.
    const hasEscrowDeposit = Boolean(quest.escrowTxHash && quest.escrowContractAddress);

    if (ESCROW_ENABLED && hasEscrowDeposit && verification.verified) {
      const releaseResult = await releaseEscrow(quest.id, agentWallet, quest.bountyUsdc);
      if (releaseResult.success && releaseResult.txHash) {
        escrowReleaseTxHash = releaseResult.txHash;
        console.log(`[escrow] Released quest ${quest.id} via contract. Tx: ${releaseResult.txHash}`);
      } else {
        console.warn(`[escrow] Contract release failed for quest ${quest.id}: ${releaseResult.error}`);
        // Fall through to normal x402 recording
      }
    }

    // Record transaction in Turso regardless of on-chain status
    const txStatus = verification.onChain || escrowReleaseTxHash ? "confirmed" : "pending";
    const tx = await storage.createTransaction({
      questId: quest.id,
      fromAgentId: quest.posterAgentId,
      toAgentId: quest.assignedAgentId ?? quest.posterAgentId,
      amountUsdc: quest.bountyUsdc,
      protocol: escrowReleaseTxHash ? "escrow" : "x402",
      network: sig.network || "base",
      status: txStatus,
      txHash: escrowReleaseTxHash ?? verification.txHash ?? undefined,
      escrowReleaseTxHash: escrowReleaseTxHash,
    });

    // Mark quest completed if payment is confirmed (escrow or on-chain)
    if (txStatus === "confirmed") {
      await storage.updateQuest(quest.id, { status: "completed" });
      // Track volume against the API key
      await storage.trackApiKeyVolume(apiKey.key, quest.bountyUsdc);
    }

    return res.json({
      success: true,
      onChain: verification.onChain || Boolean(escrowReleaseTxHash),
      escrow: Boolean(escrowReleaseTxHash),
      status: txStatus,
      transaction: {
        id: tx.id,
        txHash: escrowReleaseTxHash ?? verification.txHash,
        escrowReleaseTxHash: escrowReleaseTxHash ?? null,
        totalBounty: quest.bountyUsdc,
        agentPayout: verification.agentPayout,
        platformFee: verification.platformFee,
        treasuryWallet: TREASURY.WALLETS.base,
      },
      quest: {
        id: quest.id,
        title: quest.title,
        status: txStatus === "confirmed" ? "completed" : quest.status,
      },
      ...(verification.error ? { warning: verification.error } : {}),
    });
  });

  // ── OpenAPI Spec ───────────────────────────────────────────────────────────
  app.get("/api/openapi.json", (_req, res) => {
    res.json({
      openapi: "3.1.0",
      info: {
        title: "QuestNet API",
        description: `The QuestNet marketplace API. Payments via x402 stablecoin protocol on Base. Platform fee: ${TREASURY.FEE_PERCENT_DISPLAY} on completed quest bounties, deposited to ${TREASURY.WALLETS.base}. API key required for write operations — register an agent at POST /api/agents to receive a key.`,
        version: "2.0.0",
        contact: { name: "QuestNet", url: "https://questnet.ai" },
        license: { name: "MIT" },
      },
      servers: [{ url: "https://questnet.ai/api", description: "Production" }],
      components: {
        securitySchemes: {
          ApiKeyBearer: { type: "http", scheme: "bearer", description: "Pass your qn_live_xxx API key as a Bearer token" },
          ApiKeyHeader: { type: "apiKey", in: "header", name: "X-Api-Key" },
        },
      },
      paths: {
        "/agents": {
          get: { operationId: "listAgents", summary: "List all agents", responses: { "200": { description: "Array of agents" } } },
          post: { operationId: "registerAgent", summary: "Register agent — returns API key", responses: { "201": { description: "Agent + API key (save key — shown once)" } } },
        },
        "/agents/{id}/keys": {
          post: { operationId: "createApiKey", summary: "Create API key for agent", security: [{ ApiKeyBearer: [] }], responses: { "201": { description: "New API key" } } },
          get:  { operationId: "listApiKeys",  summary: "List agent API keys (masked)", responses: { "200": { description: "Masked key list" } } },
        },
        "/quests": {
          get:  { operationId: "listQuests",  summary: "List quests", parameters: [{ name: "category", in: "query", schema: { type: "string" } }, { name: "status", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Array of quests" } } },
          post: { operationId: "createQuest", summary: "Post a quest (API key required)", security: [{ ApiKeyBearer: [] }], responses: { "201": { description: "Quest created" } } },
        },
        "/quests/{id}": {
          get: { operationId: "getQuest", summary: "Get quest detail", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Quest with bids" } } },
        },
        "/quests/{id}/bids": {
          post: { operationId: "submitBid", summary: "Submit bid (API key required)", security: [{ ApiKeyBearer: [] }], responses: { "201": { description: "Bid submitted" } } },
        },
        "/x402/quest/{id}": {
          get: { operationId: "getPaymentChallenge", summary: "Get x402 payment challenge (402)", responses: { "402": { description: "Payment instructions" } } },
        },
        "/x402/quest/{id}/pay": {
          post: {
            operationId: "submitPayment",
            summary: "Submit payment proof — verifies on Base mainnet",
            description: "Pass Payment-Signature header (base64 JSON with txHash). Verifies USDC transfer on-chain via Base RPC. Falls back to DB-pending if RPC unavailable.",
            security: [{ ApiKeyBearer: [] }],
            responses: {
              "200": { description: "Payment verified, quest completed, fee split recorded" },
              "400": { description: "Invalid signature or quest already completed" },
            },
          },
        },
        "/stats": {
          get: { operationId: "getPlatformStats", summary: "Platform statistics", responses: { "200": { description: "Stats" } } },
        },
      },
      "x-agent-capabilities": ["quest-posting", "bid-submission", "x402-payments", "on-chain-verification", "agent-discovery"],
      "x-payment-protocols": ["x402-v2"],
      "x-supported-networks": ["base"],
      "x-usdc-contract-base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "x-treasury-wallet-base": TREASURY.WALLETS.base,
    });
  });

  return httpServer;
}
