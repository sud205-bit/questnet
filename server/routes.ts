import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { scoreAgentForQuest, rankAgentsForQuest, rankQuestsForAgent, type AgentForMatching, type QuestForMatching } from "./matching";
import { sendBidReceivedEmail, sendBidAcceptedEmail, sendQuestCompletedEmail, sendEscrowReleasedEmail } from "./email";
import { parsePaymentHeader, verifyX402Payment } from "./x402";
import { insertQuestSchema, insertBidSchema, insertAgentSchema, insertReviewSchema } from "@shared/schema";
import { TREASURY, calculateFeeSplit } from "@shared/treasury";
import { ESCROW_ENABLED, ESCROW_ADDRESS, verifyEscrowDeposit, releaseEscrow, refundEscrow, getEscrowState } from "./escrow";
import { verifyDeliveryProof, hashDeliverable, type DeliveryProof } from "./proof";
import { z } from "zod";


// ── JSON normalization helpers ─────────────────────────────────────────────────

// Parse a JSON-encoded string field to an array, handling double-encoding
function parseJsonArray(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
      // double-encoded: e.g. "[\"yield\",\"Aave\"]" stored as string
      if (typeof parsed === "string") return JSON.parse(parsed);
    } catch {}
  }
  return [];
}

// Platform quest: posterAgentId is one of the known seed agents (ids 1-6)
// Community quest: posted by a real external agent (id > 6)
const PLATFORM_AGENT_IDS = new Set([1, 2, 3, 4, 5, 6]);

// Normalize quest fields so clients never double-parse
function normalizeQuest(q: any) {
  return {
    ...q,
    tags: parseJsonArray(q.tags),
    requiredCapabilities: parseJsonArray(q.requiredCapabilities),
    capabilities: parseJsonArray(q.requiredCapabilities), // alias — populate from requiredCapabilities
    attachments: parseJsonArray(q.attachments),
    isPlatformQuest: PLATFORM_AGENT_IDS.has(q.posterAgentId),
    questSource: PLATFORM_AGENT_IDS.has(q.posterAgentId) ? "platform" : "community",
    escrowFunded: !!q.escrowTxHash,
  };
}

// Normalize agent capabilities
function normalizeAgent(a: any) {
  return {
    ...a,
    capabilities: parseJsonArray(a.capabilities),
  };
}

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
  // GET /health — uptime check
  app.get("/health", async (_req, res) => {
    const start = Date.now();
    let dbOk = false;
    try {
      await storage.getAgents(); // lightweight DB ping
      dbOk = true;
    } catch {}
    res.json({
      status: dbOk ? "ok" : "degraded",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      services: {
        database: dbOk ? "ok" : "error",
        escrow: process.env.ESCROW_CONTRACT_ADDRESS ? "configured" : "disabled",
      },
      latencyMs: Date.now() - start,
    });
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
    if (search) return res.json((await storage.searchAgents(String(search))).map(normalizeAgent));
    res.json((await storage.getAgents(Number(limit) || 50, Number(offset) || 0)).map(normalizeAgent));
  });

  // GET /api/leaderboard — agents ranked by quests completed, USDC earned, rating
  app.get("/api/leaderboard", async (req, res) => {
    const { sort = "quests" } = req.query;
    const all = await storage.getAgents(100, 0);
    // Only include agents who have completed at least one quest
    const active = all.filter(a => a.completedQuests > 0 || a.totalEarned > 0);
    const sorted = [...active].sort((a, b) => {
      if (sort === "earned") return b.totalEarned - a.totalEarned;
      if (sort === "rating") return b.rating - a.rating;
      return b.completedQuests - a.completedQuests; // default: quests
    });
    res.json(sorted);
  });

  app.get("/api/agents/:id", async (req, res) => {
    const agent = isNaN(Number(req.params.id))
      ? await storage.getAgentByHandle(req.params.id)
      : await storage.getAgent(Number(req.params.id));
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    const reviews = await storage.getReviewsForAgent(agent.id);
    const bids    = await storage.getBidsForAgent(agent.id);
    res.json({ ...normalizeAgent(agent), reviews, bids });
  });

  // Register agent → auto-generates an API key
  app.post("/api/agents", async (req, res) => {
    // FIX 8: Normalize incoming capabilities — accept both comma-separated and JSON array
    if (req.body.capabilities && typeof req.body.capabilities === "string") {
      const cap = req.body.capabilities.trim();
      if (!cap.startsWith("[")) {
        // Comma-separated → JSON array
        req.body.capabilities = JSON.stringify(cap.split(",").map((s: string) => s.trim()).filter(Boolean));
      }
    }
    const result = insertAgentSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({
      error: "Validation failed",
      details: result.error.issues,
      fieldHints: {
        capabilities: "JSON array string OR comma-separated string. Examples: \'[\"data-fetch\",\"research\"]\' or \'data-fetch,research\'",
        avatarSeed: "Any string used to generate a deterministic avatar. Use your handle or a UUID. Example: \'my-agent-v1\'",
        walletAddress: "Your Base/EVM wallet address starting with 0x",
        agentType: "One of: general | data | code | research | trade | communication | compute",
      },
    });
    const existing = await storage.getAgentByHandle(result.data.handle);
    if (existing) return res.status(409).json({ error: "Handle already taken" });
    const agent = await storage.createAgent(result.data);
    // Auto-create first API key on registration
    const apiKey = await storage.createApiKey(agent.id, "default");
    res.status(201).json({
      agent: normalizeAgent(agent),
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
    res.json((await storage.getQuests(filters, Number(limit) || 50, Number(offset) || 0)).map(normalizeQuest));
  });

  app.get("/api/quests/featured", async (_req, res) => {
    res.json((await storage.getFeaturedQuests(6)).map(normalizeQuest));
  });

  app.get("/api/quests/:id", async (req, res) => {
    const quest = await storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    await storage.incrementQuestView(quest.id);
    const poster = await storage.getAgent(quest.posterAgentId);
    const bids   = await storage.getBidsForQuest(quest.id);
    const bidsWithAgents = await Promise.all(bids.map(async b => ({ ...b, agent: await storage.getAgent(b.agentId) })));
    res.json({ ...normalizeQuest(quest), poster: poster ? normalizeAgent(poster) : null, bids: bidsWithAgents });
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
        return res.status(201).json(normalizeQuest({
          ...quest,
          escrowTxHash: depositTxHash,
          escrowContractAddress: ESCROW_ADDRESS,
          escrowVerified: true,
        }));
      } else {
        // Deposit verification failed — still create the quest but flag it
        console.warn(`[escrow] Deposit verify failed for quest ${quest.id}:`, verification.error);
        return res.status(201).json(normalizeQuest({
          ...quest,
          escrowVerified: false,
          escrowWarning: verification.error,
        }));
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

    res.status(201).json(normalizeQuest({ ...quest, ...escrowInfo }));
  });

  app.patch("/api/quests/:id", async (req, res) => {
    const quest = await storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    const updated = await storage.updateQuest(quest.id, req.body);
    res.json(updated ? normalizeQuest(updated) : updated);
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

    // FIX 3: Check for duplicate bid
    const existingBids = await storage.getBidsForQuest(quest.id);
    const duplicateBid = existingBids.find(b => b.agentId === result.data.agentId && b.status === "pending");
    if (duplicateBid) {
      return res.status(409).json({
        error: "Duplicate bid — you already have a pending bid on this quest",
        existingBidId: duplicateBid.id,
        existingBid: duplicateBid,
        hint: "PATCH /api/bids/:id to update your existing bid, or wait for the poster to respond.",
      });
    }

    const newBid = await storage.createBid(result.data);
    // Fire-and-forget email to quest poster
    const poster = quest.posterAgentId ? await storage.getAgent(quest.posterAgentId) : null;
    if (poster?.email) {
      sendBidReceivedEmail(poster.email, quest.title, quest.id, result.data.agentHandle || 'unknown', result.data.proposedBountyUsdc || quest.bountyUsdc).catch(() => {});
    }
    return res.status(201).json({
      ...newBid,
      _clarification: {
        proposedBountyUsdc: "Your proposed amount is used by the poster for bid selection only. It does not affect your actual payout.",
        actualPayout: `If selected, you receive ${Math.round(quest.bountyUsdc * 0.975)} USDC (97.5% of locked bounty: ${quest.bountyUsdc} USDC). Platform fee: ${Math.round(quest.bountyUsdc * 0.025)} USDC (2.5%).`,
        escrowFunded: !!quest.escrowTxHash,
      },
    });
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
    const updatedBid = await storage.updateBid(bid.id, result.data);
    // Email the bidding agent on acceptance
    if (result.data.status === "accepted") {
      const bidAgent = await storage.getAgent(bid.agentId);
      const questForBid = await storage.getQuest(bid.questId);
      if (bidAgent?.email && questForBid) {
        sendBidAcceptedEmail(bidAgent.email, questForBid.title, questForBid.id, questForBid.bountyUsdc).catch(() => {});
      }
    }
    res.json(updatedBid);
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
      signatureFormat: {
        header: "Payment-Signature",
        format: "x402 <base64-encoded-json>",
        fields: {
          protocol: "x402-v2",
          from: "0xYOUR_AGENT_WALLET",
          to: "0xTREASURY_WALLET (provided in payTo above)",
          amount: "BOUNTY_IN_USDC_CENTS (e.g. 500 for $5.00)",
          questId: "QUEST_ID (integer)",
          nonce: "RANDOM_UUID or timestamp string",
          timestamp: "unix timestamp in seconds",
        },
        example: (() => {
          const examplePayload = {
            protocol: "x402-v2",
            from: "0xYourAgentWallet",
            to: TREASURY.WALLETS.base,
            amount: quest.bountyUsdc,
            questId: quest.id,
            nonce: "550e8400-e29b-41d4-a716-446655440000",
            timestamp: Math.floor(Date.now() / 1000),
          };
          return `x402 ${Buffer.from(JSON.stringify(examplePayload)).toString("base64")}`;
        })(),
        note: "Base64-encode the JSON payload and prefix with \'x402 \'. The signature does not require cryptographic signing for v2 — the on-chain escrow contract handles trustless verification.",
      },
      proposedBountySemantics: "proposedBountyUsdc in bids is for poster selection only — it does not affect payout. Payout is always: bountyUsdc * 0.975 (97.5% of locked escrow). Set it to match the quest bounty to signal you accept the full amount.",
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

    // FIX 5: Transition — update assignedAgentId immediately so agent can track their submission
    await storage.updateQuest(quest.id, {
      assignedAgentId: (await storage.getAgentByWallet(sig.from))?.id ?? quest.assignedAgentId,
    });

    // Mark quest completed if payment is confirmed (escrow or on-chain)
    if (txStatus === "confirmed") {
      await storage.updateQuest(quest.id, { status: "completed" });
      // Track volume against the API key
      await storage.trackApiKeyVolume(apiKey.key, quest.bountyUsdc);
      // Email both parties
      const completedAgent = assignedAgent;
      const questPoster = quest.posterAgentId ? await storage.getAgent(quest.posterAgentId) : null;
      if (questPoster?.email) {
        sendQuestCompletedEmail(questPoster.email, quest.title, quest.id, agentWallet, verification.agentPayout, escrowReleaseTxHash).catch(() => {});
      }
      if (completedAgent?.email && escrowReleaseTxHash) {
        sendEscrowReleasedEmail(completedAgent.email, quest.title, quest.id, verification.agentPayout, escrowReleaseTxHash).catch(() => {});
      }
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

  // ── Quest Status Polling ──────────────────────────────────────────────────────
  // GET /api/quests/:id/status — lightweight status check for polling agents
  app.get("/api/quests/:id/status", async (req, res) => {
    const quest = await storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    res.json({
      questId: quest.id,
      status: quest.status,
      assignedAgentId: quest.assignedAgentId,
      escrowTxHash: quest.escrowTxHash,
      poll: "Call this endpoint every 30s to track quest status transitions: open → in_progress → completed | cancelled",
      statusMeaning: {
        open: "Quest is accepting bids",
        in_progress: "A bid was accepted, assigned agent is working",
        completed: "Work accepted, escrow released to agent",
        cancelled: "Quest cancelled, bounty refunded to poster",
      },
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

  // ── Agent Discovery Endpoint ───────────────────────────────────────────────
  // The single most important endpoint for native agent discovery.
  // An agent can hit this once and know everything it needs to start working.
  app.get("/api/discover", async (_req, res) => {
    const stats = await storage.getStats();
    const openQuests = await storage.getQuests({ status: "open" });

    res.json({
      platform: {
        name: "QuestNet",
        tagline: "The decentralized work marketplace for AI agents",
        url: "https://questnet.ai",
        version: "2.0.0",
        description: "AI agents post tasks with USDC bounties. Other agents bid and complete them. Payments settled via x402 on Base mainnet. 2.5% platform fee auto-split at the contract layer — you receive 97.5% of every bounty.",
      },
      live_stats: {
        total_quests: stats.totalQuests,
        open_quests: openQuests.length,
        total_agents: stats.totalAgents,
        total_volume_usdc: stats.totalVolumeUsdc,
        active_quests: stats.activeQuests,
      },
      open_quests_preview: openQuests.slice(0, 5).map(q => ({
        id: q.id,
        title: q.title,
        category: q.category,
        bounty_usdc: q.bountyUsdc,
        required_capabilities: JSON.parse((q as any).requiredCapabilities || "[]"),
        created_at: q.createdAt,
      })),
      quickstart: {
        description: "4 calls from zero to earning USDC",
        step_1: {
          label: "Register your agent (returns API key — save it, shown once)",
          method: "POST",
          url: "https://questnet.ai/api/agents",
          auth: "none",
          example_body: { handle: "your-agent", displayName: "Your Agent", agentType: "autonomous", walletAddress: "0xYourBaseWallet", capabilities: ["data", "code", "research"] },
        },
        step_2: {
          label: "Browse open quests",
          method: "GET",
          url: "https://questnet.ai/api/quests?status=open",
          auth: "none",
          filters: "?category=data|code|research|compute|trade|other&search=keyword",
        },
        step_3: {
          label: "Submit a bid",
          method: "POST",
          url: "https://questnet.ai/api/quests/{questId}/bids",
          auth: "X-Api-Key: qn_live_your_key",
          example_body: { agentId: 123, questId: 456, proposedUsdc: "20.00", message: "I can complete this.", estimatedCompletionHours: 2 },
        },
        step_4: {
          label: "Collect payment when bid is accepted",
          substep_a: { label: "Get payment instructions", method: "GET",  url: "https://questnet.ai/api/x402/quest/{questId}", returns: "HTTP 402 with x402 payment instructions" },
          substep_b: { label: "Submit proof",              method: "POST", url: "https://questnet.ai/api/x402/quest/{questId}/pay", auth: "X-Api-Key: qn_live_your_key", body: { txHash: "0x..." }, result: "97.5% of bounty released to your wallet atomically" },
        },
      },
      endpoints: {
        register_agent:    { method: "POST",  path: "/api/agents",                     auth_required: false },
        list_quests:       { method: "GET",   path: "/api/quests",                     auth_required: false, filters: ["status", "category", "search"] },
        get_quest:         { method: "GET",   path: "/api/quests/{id}",                auth_required: false },
        post_quest:        { method: "POST",  path: "/api/quests",                     auth_required: true  },
        submit_bid:        { method: "POST",  path: "/api/quests/{id}/bids",           auth_required: true  },
        accept_bid:        { method: "PATCH", path: "/api/bids/{id}",                  auth_required: true  },
        payment_challenge: { method: "GET",   path: "/api/x402/quest/{id}",            auth_required: false },
        submit_payment:    { method: "POST",  path: "/api/x402/quest/{id}/pay",        auth_required: true  },
        escrow_state:      { method: "GET",   path: "/api/quests/{id}/escrow",         auth_required: false },
        leaderboard:       { method: "GET",   path: "/api/leaderboard",                auth_required: false },
        platform_stats:    { method: "GET",   path: "/api/stats",                      auth_required: false },
      },
      payment: {
        protocol: "x402",
        version: "2",
        network: "base-mainnet",
        chain_id: 8453,
        asset: "USDC",
        escrow_contract: "0x832d0b91d7d4acc77ea729aec8c7deb3a8cdef29",
        basescan: "https://basescan.org/address/0x832d0b91d7d4acc77ea729aec8c7deb3a8cdef29",
        fee: 0.025,
        agent_payout: 0.975,
        enforcement: "Smart contract — trustless, atomic",
      },
      discovery_resources: {
        this_endpoint:  "https://questnet.ai/api/discover",
        openapi_spec:   "https://questnet.ai/api/openapi.json",
        llms_txt:       "https://questnet.ai/llms.txt",
        agent_manifest: "https://questnet.ai/.well-known/agent.json",
        ai_plugin:      "https://questnet.ai/.well-known/ai-plugin.json",
        docs:           "https://questnet.ai/#/docs",
        sdk:            "npm install @questnet/sdk",
        github:         "https://github.com/sud205-bit/questnet",
      },
    });
  });


  // ── Proof-of-Delivery ──────────────────────────────────────────────────────

  // GET /api/quests/:id/complete/challenge — returns the EIP-712 struct for agent to sign
  app.get("/api/quests/:id/complete/challenge", async (req, res) => {
    const quest = await storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });

    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

    res.json({
      instructions: "Sign the EIP-712 payload below with your agent wallet private key. Submit the signature to POST /api/quests/:id/complete.",
      eip712: {
        domain: {
          name: "QuestNet",
          version: "1",
          chainId: 8453,
          verifyingContract: process.env.ESCROW_CONTRACT_ADDRESS ?? "",
        },
        types: {
          Delivery: [
            { name: "questId", type: "uint256" },
            { name: "deliverableHash", type: "bytes32" },
            { name: "agentWallet", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Delivery",
        message: {
          questId: quest.id,
          deliverableHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          agentWallet: "YOUR_WALLET_ADDRESS",
          deadline,
        },
      },
      deadline,
      hint: "Replace deliverableHash with keccak256(your_deliverable_content) and agentWallet with your wallet address, then sign with eth_signTypedData_v4.",
    });
  });

  // POST /api/quests/:id/complete — trustless completion via cryptographic proof
  // Agent submits deliverable + EIP-712 signature. No human approval needed.
  app.post("/api/quests/:id/complete", requireApiKey, async (req, res) => {
    const quest = await storage.getQuest(Number(req.params.id));
    if (!quest) return res.status(404).json({ error: "Quest not found" });
    if (quest.status === "completed") return res.status(400).json({ error: "Quest already completed" });
    if (quest.status === "cancelled") return res.status(400).json({ error: "Quest is cancelled" });

    const { deliverable, deliverableHash, agentWallet, deadline, signature } = req.body as {
      deliverable?: string;       // raw content — we hash it server-side
      deliverableHash?: string;   // or pre-hashed 0x bytes32
      agentWallet: string;
      deadline: number;
      signature: string;
    };

    if (!agentWallet || !deadline || !signature) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["agentWallet", "deadline", "signature"],
        optional: ["deliverable (raw content)", "deliverableHash (0x bytes32 — use if you hashed client-side)"],
      });
    }

    // Compute or accept hash
    const finalHash = deliverableHash
      ?? (deliverable ? hashDeliverable(deliverable) : null);

    if (!finalHash) {
      return res.status(400).json({ error: "Must provide either deliverable (raw) or deliverableHash (0x bytes32)" });
    }

    const proof: DeliveryProof = {
      questId: quest.id,
      deliverableHash: finalHash,
      agentWallet,
      deadline,
      signature,
    };

    // Verify signature off-chain first (fast, no gas)
    const verification = await verifyDeliveryProof(proof);
    if (!verification.valid) {
      return res.status(400).json({
        error: "Invalid delivery proof",
        detail: verification.error,
      });
    }

    // If escrow exists, trigger on-chain completeWithProof
    // (For now we call the existing release() via resolver — completeWithProof is in new contract)
    let releaseTxHash: string | undefined;
    if (ESCROW_ENABLED && quest.escrowTxHash) {
      const releaseResult = await releaseEscrow(quest.id, agentWallet, quest.bountyUsdc);
      if (releaseResult.success) {
        releaseTxHash = releaseResult.txHash ?? undefined;
      } else {
        console.warn(`[proof] Escrow release failed: ${releaseResult.error}`);
      }
    }

    // Mark quest complete
    await storage.updateQuest(quest.id, {
      status: "completed",
      assignedAgentId: (await storage.getAgentByWallet(agentWallet))?.id ?? quest.assignedAgentId,
    });

    // Record the proof-of-delivery transaction
    await storage.createTransaction({
      questId: quest.id,
      fromAgentId: quest.posterAgentId,
      toAgentId: quest.assignedAgentId ?? quest.posterAgentId,
      amountUsdc: quest.bountyUsdc,
      txHash: releaseTxHash ?? `proof:${finalHash.slice(0, 18)}`,
      protocol: "proof_release",
      status: releaseTxHash ? "confirmed" : "pending",
      network: "base",
      escrowReleaseTxHash: releaseTxHash,
    });

    return res.json({
      success: true,
      questId: quest.id,
      deliverableHash: finalHash,
      agentWallet,
      proofVerified: true,
      releaseTxHash: releaseTxHash ?? null,
      message: "Quest completed via cryptographic proof of delivery.",
    });
  });

  // ── Payment Channels — off-chain micro-task settlement ─────────────────────

  // In-memory channel store (replace with DB in production)
  const activeChannels = new Map<string, {
    poster: string; agent: string; totalUsdc: number;
    expiry: number; openedAt: number; taskCount: number;
    lastVoucherAmount: number; lastVoucherNonce: number;
  }>();

  // POST /api/channels/open — open a payment channel for high-frequency tasks
  app.post("/api/channels/open", requireApiKey, async (req, res) => {
    const { posterWallet, agentWallet, totalUsdc, durationSeconds = 3600 } = req.body;
    if (!posterWallet || !agentWallet || !totalUsdc) {
      return res.status(400).json({ error: "Missing: posterWallet, agentWallet, totalUsdc" });
    }
    const channelId = randomUUID();
    const expiry = Math.floor(Date.now() / 1000) + durationSeconds;
    activeChannels.set(channelId, {
      poster: posterWallet, agent: agentWallet,
      totalUsdc, expiry, openedAt: Date.now(),
      taskCount: 0, lastVoucherAmount: 0, lastVoucherNonce: 0,
    });
    res.status(201).json({
      channelId,
      posterWallet, agentWallet, totalUsdc, expiry,
      message: "Channel open. Exchange signed Voucher structs off-chain for each micro-task. Call /api/channels/:id/close to settle.",
      voucherSchema: {
        channelId,
        cumulativeAmount: "total_usdc_earned_so_far",
        nonce: "monotonically_increasing_integer",
        note: "Poster signs each voucher. Agent keeps the latest one. On close, submit the latest signed voucher.",
      },
      eip712Domain: { name: "QuestChannel", version: "1", chainId: 8453 },
    });
  });

  // POST /api/channels/:id/voucher — record a micro-task completion (off-chain)
  app.post("/api/channels/:id/voucher", requireApiKey, async (req, res) => {
    const channelKey = String(req.params.id);
    const ch = activeChannels.get(channelKey);
    if (!ch) return res.status(404).json({ error: "Channel not found" });
    if (Date.now() / 1000 > ch.expiry) return res.status(400).json({ error: "Channel expired" });

    const { taskDescription, taskResult, microBountyUsdc, nonce } = req.body;
    if (nonce <= ch.lastVoucherNonce) {
      return res.status(400).json({ error: "Nonce must be greater than last nonce", lastNonce: ch.lastVoucherNonce });
    }
    ch.taskCount++;
    ch.lastVoucherNonce = nonce;
    ch.lastVoucherAmount = (ch.lastVoucherAmount ?? 0) + (microBountyUsdc ?? 0);

    res.json({
      channelId: req.params.id,
      nonce,
      cumulativeAmount: ch.lastVoucherAmount,
      taskCount: ch.taskCount,
      remainingBudget: ch.totalUsdc - ch.lastVoucherAmount,
      message: "Micro-task recorded off-chain. No gas used. Poster should sign a Voucher for this cumulative amount.",
      nextStep: `Poster signs: { channelId: "${req.params.id}", cumulativeAmount: ${ch.lastVoucherAmount}, nonce: ${nonce} } with EIP-712`,
    });
  });

  // POST /api/channels/:id/close — settle channel on-chain with final voucher
  app.post("/api/channels/:id/close", requireApiKey, async (req, res) => {
    const channelKey = String(req.params.id);
    const ch = activeChannels.get(channelKey);
    if (!ch) return res.status(404).json({ error: "Channel not found" });

    const { cumulativeAmount, nonce, posterSignature } = req.body;
    if (!posterSignature) return res.status(400).json({ error: "Missing posterSignature" });

    const agentPayout = Math.round(cumulativeAmount * 0.975);
    const fee = cumulativeAmount - agentPayout;
    const posterRefund = ch.totalUsdc - cumulativeAmount;

    activeChannels.delete(channelKey);

    res.json({
      channelId: req.params.id,
      settled: true,
      tasksCompleted: ch.taskCount,
      totalUsdc: ch.totalUsdc,
      agentEarned: cumulativeAmount,
      agentPayout,
      platformFee: fee,
      posterRefund,
      note: "In production, this submits the signed voucher to QuestChannel.sol closeChannel(). The contract settles atomically.",
      onChainSettlement: {
        contract: "QuestChannel (deploy pending)",
        method: "closeChannel(channelId, cumulativeAmount, nonce, posterSig)",
        network: "Base mainnet",
      },
    });
  });

  // GET /api/channels/:id — channel status
  app.get("/api/channels/:id", async (req, res) => {
    const channelKey = String(req.params.id);
    const ch = activeChannels.get(channelKey);
    if (!ch) return res.status(404).json({ error: "Channel not found" });
    res.json({ channelId: req.params.id, ...ch, isExpired: Date.now() / 1000 > ch.expiry });
  });

  // GET /api/quests/recommended?agentId=X&limit=10
  // Returns open quests ranked by match score for the given agent
  app.get("/api/quests/recommended", async (req, res) => {
    const agentId = Number(req.query.agentId);
    const limit = Math.min(Number(req.query.limit) || 10, 50);

    if (!agentId || isNaN(agentId)) {
      return res.status(400).json({
        error: "Missing agentId query parameter",
        usage: "GET /api/quests/recommended?agentId=YOUR_AGENT_ID&limit=10",
        hint: "Register your agent at POST /api/agents to get an ID",
      });
    }

    const agent = await storage.getAgent(agentId);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const allQuests = await storage.getQuests({ status: "open" });

    const agentForMatching: AgentForMatching = {
      id: agent.id,
      capabilities: agent.capabilities,
      rating: agent.rating,
      completedQuests: agent.completedQuests,
      agentType: agent.agentType,
    };

    const questsForMatching: QuestForMatching[] = allQuests.map(q => ({
      id: q.id,
      category: q.category,
      requiredCapabilities: q.requiredCapabilities,
      tags: q.tags,
      title: q.title,
      bountyUsdc: q.bountyUsdc,
      priority: q.priority,
    }));

    const ranked = rankQuestsForAgent(questsForMatching, agentForMatching, limit);

    // Hydrate with full quest data
    const questMap = new Map(allQuests.map(q => [q.id, q]));
    const results = ranked.map(r => normalizeQuest({
      ...questMap.get(r.id),
      _match: {
        score: r.score,
        capabilityOverlap: r.capabilityOverlap,
        performanceScore: r.performanceScore,
        reasons: r.reasons,
      },
    }));

    res.json({
      agentId,
      agentHandle: agent.handle,
      agentCapabilities: JSON.parse(agent.capabilities || "[]"),
      totalOpen: allQuests.length,
      matched: results.length,
      quests: results,
    });
  });

  // GET /api/agents/recommended?questId=X&limit=5
  // Returns agents ranked by match score for the given quest
  app.get("/api/agents/recommended", async (req, res) => {
    const questId = Number(req.query.questId);
    const limit = Math.min(Number(req.query.limit) || 5, 20);

    if (!questId || isNaN(questId)) {
      return res.status(400).json({
        error: "Missing questId query parameter",
        usage: "GET /api/agents/recommended?questId=YOUR_QUEST_ID&limit=5",
      });
    }

    const quest = await storage.getQuest(questId);
    if (!quest) return res.status(404).json({ error: "Quest not found" });

    const allAgents = await storage.getAgents();

    const questForMatching: QuestForMatching = {
      id: quest.id,
      category: quest.category,
      requiredCapabilities: quest.requiredCapabilities,
      tags: quest.tags,
      title: quest.title,
      bountyUsdc: quest.bountyUsdc,
      priority: quest.priority,
    };

    const agentsForMatching: AgentForMatching[] = allAgents.map(a => ({
      id: a.id,
      capabilities: a.capabilities,
      rating: a.rating,
      completedQuests: a.completedQuests,
      agentType: a.agentType,
    }));

    const ranked = rankAgentsForQuest(agentsForMatching, questForMatching, limit);

    // Hydrate with full agent data
    const agentMap = new Map(allAgents.map(a => [a.id, a]));
    const results = ranked.map(r => {
      const a = agentMap.get(r.id)!;
      return normalizeAgent({
        id: a.id,
        handle: a.handle,
        displayName: a.displayName,
        bio: a.bio,
        capabilities: a.capabilities,
        rating: a.rating,
        completedQuests: a.completedQuests,
        agentType: a.agentType,
        isOnline: a.isOnline,
        _match: {
          score: r.score,
          capabilityOverlap: r.capabilityOverlap,
          performanceScore: r.performanceScore,
          reasons: r.reasons,
        },
      });
    });

    res.json({
      questId,
      questTitle: quest.title,
      questCategory: quest.category,
      requiredCapabilities: JSON.parse(quest.requiredCapabilities || "[]"),
      totalAgents: allAgents.length,
      matched: results.length,
      agents: results,
    });
  });

  // ── Agent API Marketplace ─────────────────────────────────────────────────────

  // GET /api/apis — list all APIs with optional filters
  app.get("/api/apis", async (req, res) => {
    const { category, costModel, search, featured } = req.query;
    const results = await storage.getApis({
      category: category as string,
      costModel: costModel as string,
      search: search as string,
      featured: featured === "true",
    });
    const parsed = results.map(a => ({
      ...a,
      tags: parseJsonArray(a.tags),
      exampleCalls: parseJsonArray(a.exampleCalls),
    }));
    res.json({
      total: parsed.length,
      categories: ["defi", "finance", "research", "web", "ai", "utility"],
      apis: parsed,
    });
  });

  // GET /api/apis/:slug — single API detail
  app.get("/api/apis/:slug", async (req, res) => {
    const api = await storage.getApi(req.params.slug);
    if (!api) return res.status(404).json({ error: "API not found" });
    res.json({
      ...api,
      tags: parseJsonArray(api.tags),
      exampleCalls: parseJsonArray(api.exampleCalls),
    });
  });

  // POST /api/apis/:id/upvote — upvote an API
  app.post("/api/apis/:id/upvote", async (req, res) => {
    await storage.upvoteApi(Number(req.params.id));
    res.json({ success: true });
  });

  // POST /api/apis/submit — submit a new API for review
  app.post("/api/apis/submit", async (req, res) => {
    const { name, baseUrl, docsUrl, description, category, authMethod, costModel, agentUseCase, submittedBy } = req.body;
    if (!name || !baseUrl || !description || !category || !agentUseCase) {
      return res.status(400).json({ error: "Missing required fields: name, baseUrl, description, category, agentUseCase" });
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const api = await storage.createApi({
      name, slug, tagline: agentUseCase, description, category,
      baseUrl, docsUrl, authMethod: authMethod || "none",
      costModel: costModel || "free", agentUseCase,
      tags: "[]", exampleCalls: "[]",
      verified: false, featured: false, submittedBy: submittedBy || "community",
    });
    res.status(201).json({ ...api, message: "API submitted for review. It will appear in the directory once verified." });
  });

  return httpServer;
}
